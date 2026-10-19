package com.NormaOne.backend.services;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.admin.InvitationInfo;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.InvitationDeliveryException;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.DeliveryMediumType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserNotFoundException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserStatusType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

/**
 * Administrator-created invitations through Cognito's own temporary-password flow.
 *
 * AdminCreateUser is called WITHOUT a TemporaryPassword, so Cognito generates one and emails it in
 * its invitation message (the user pool's "invitation message" template, which is also where the
 * login URL goes — see docs/AUTH_RBAC_GUIDE.md). This backend never sees, stores, logs or audits the
 * password. The account is created in FORCE_CHANGE_PASSWORD: its first sign-in answers with the
 * NEW_PASSWORD_REQUIRED challenge and grants nothing until a permanent password is set.
 *
 * The email is marked verified (email_verified=true) because the invitation was delivered to it — so
 * no separate verification-code email is sent, and the ID token issued after the password change
 * carries the verified email that links the invitation (AccountLinkService).
 *
 * Callers write the invitation record first and delete it again when this throws
 * InvitationDeliveryException, so a failure never leaves somebody INVITED with no email on its way.
 * Needs AWS credentials allowed cognito-idp:AdminCreateUser (and AdminGetUser for the
 * already-exists case). Without them, set normaone.invitations.send-temporary-password=false.
 */
@Service
public class CognitoInvitationService {

    private static final Logger log = LoggerFactory.getLogger(CognitoInvitationService.class);

    private final CognitoIdentityProviderClient cognito;
    private final String userPoolId;
    private final NormaOneProperties properties;

    public CognitoInvitationService(
            CognitoIdentityProviderClient cognito,
            @Value("${aws.cognito.user-pool-id:#{null}}") String userPoolId,
            NormaOneProperties properties) {
        this.cognito = cognito;
        this.userPoolId = userPoolId;
        this.properties = properties;
    }

    public boolean enabled() {
        return properties.getInvitations().isSendTemporaryPassword();
    }

    /** Creates the invited person's Cognito account and has Cognito email the temporary password. */
    public InvitationInfo invite(String email, String name) {
        if (!enabled()) {
            return new InvitationInfo(InvitationInfo.SELF_REGISTRATION, false,
                    "No email was sent. Ask " + email + " to register with this email; the invitation links at their first sign-in.");
        }
        try {
            cognito.adminCreateUser(AdminCreateUserRequest.builder()
                    .userPoolId(userPoolId)
                    .username(email)
                    .userAttributes(
                            AttributeType.builder().name("email").value(email).build(),
                            AttributeType.builder().name("email_verified").value("true").build(),
                            AttributeType.builder().name("name").value(name).build())
                    .desiredDeliveryMediums(DeliveryMediumType.EMAIL)
                    .build());
            log.info("Invitation with a temporary password sent by Cognito.");
            return sent(email);
        } catch (UsernameExistsException exists) {
            return alreadyInCognito(email, name);
        } catch (CognitoIdentityProviderException ex) {
            throw new InvitationDeliveryException(
                    "The invitation could not be created in Cognito, so no email was sent. Nothing was saved; try again.", ex);
        }
    }

    /**
     * Sends a pending invitation again, with a new temporary password (AdminCreateUser RESEND). Also
     * the remedy for an expired temporary password. Refused for an account that already set its own
     * password: there is no invitation left to resend.
     */
    public InvitationInfo resend(String email, String name) {
        if (!enabled()) {
            throw new ConflictException("Temporary-password invitations are switched off: there is no email to resend. "
                    + "The person registers with " + email + " themselves.");
        }
        Optional<AdminGetUserResponse> account = lookup(email);
        if (account.isEmpty()) {
            return invite(email, name);
        }
        if (!UserStatusType.FORCE_CHANGE_PASSWORD.equals(account.get().userStatus())) {
            throw new ConflictException("This person already has a Cognito account with their own password; they sign in with it.");
        }
        try {
            cognito.adminCreateUser(AdminCreateUserRequest.builder()
                    .userPoolId(userPoolId)
                    .username(email)
                    .messageAction(MessageActionType.RESEND)
                    .desiredDeliveryMediums(DeliveryMediumType.EMAIL)
                    .build());
            log.info("Invitation resent by Cognito with a new temporary password.");
            return sent(email);
        } catch (CognitoIdentityProviderException ex) {
            throw new InvitationDeliveryException("Cognito could not resend the invitation. Try again.", ex);
        }
    }

    /** The email already has a Cognito account: resend a pending invitation, or link an established account. */
    private InvitationInfo alreadyInCognito(String email, String name) {
        Optional<AdminGetUserResponse> account = lookup(email);
        if (account.isPresent() && UserStatusType.FORCE_CHANGE_PASSWORD.equals(account.get().userStatus())) {
            return resend(email, name);
        }
        return new InvitationInfo(InvitationInfo.EXISTING_ACCOUNT, false,
                email + " already has a NormaOne sign-in with its own password. No email was sent: the invitation links "
                        + "when they next sign in" + (account.isPresent() && UserStatusType.UNCONFIRMED.equals(account.get().userStatus())
                        ? ", once they verify their email." : "."));
    }

    private Optional<AdminGetUserResponse> lookup(String email) {
        try {
            return Optional.ofNullable(cognito.adminGetUser(AdminGetUserRequest.builder().userPoolId(userPoolId).username(email).build()));
        } catch (UserNotFoundException missing) {
            return Optional.empty();
        } catch (CognitoIdentityProviderException ex) {
            throw new InvitationDeliveryException("Cognito could not be asked about this email. Try again.", ex);
        }
    }

    private static InvitationInfo sent(String email) {
        return new InvitationInfo(InvitationInfo.TEMPORARY_PASSWORD, true,
                "An invitation email with a temporary password was sent to " + email
                        + ". At their first sign-in they will be asked to set a permanent password.");
    }
}
