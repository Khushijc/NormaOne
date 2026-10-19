package com.NormaOne.backend.services;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.exceptions.IdentityProviderException;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminDisableUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminEnableUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminUserGlobalSignOutRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserNotFoundException;

/**
 * Keeps a person's Cognito account consistent with their application status. The Cognito username
 * is the email address everywhere in this application (registration and invitations).
 *
 * SEQUENCING, since the two cannot change atomically:
 * <ul>
 *   <li>Removing access (SUSPENDED, DEACTIVATED): the application record is saved FIRST, which already
 *       blocks every request (authorization reads the record each time); then Cognito signs the
 *       account out everywhere (refresh tokens revoked) and, for DEACTIVATED, disables it. A Cognito
 *       failure leaves access removed and is reported as FAILED for the audit trail and the logs.</li>
 *   <li>Restoring access (back to ACTIVE or INVITED): Cognito re-enables the account FIRST, only if it
 *       is disabled; if that fails, the change is refused with 502 and nothing is saved, so the record
 *       never says ACTIVE for an account that cannot sign in.</li>
 * </ul>
 * Off with normaone.identity.sync-account-status=false (or without a user pool id): outcome SKIPPED.
 */
@Service
public class CognitoAccountAccessService {

    private static final Logger log = LoggerFactory.getLogger(CognitoAccountAccessService.class);

    /** What happened in Cognito, as recorded in the audit details ("identityProvider"). */
    public static final String DONE = "DONE";
    public static final String SKIPPED = "SKIPPED";
    public static final String NO_ACCOUNT = "NO_ACCOUNT";
    public static final String FAILED = "FAILED";

    private final CognitoIdentityProviderClient cognito;
    private final String userPoolId;
    private final NormaOneProperties properties;

    public CognitoAccountAccessService(CognitoIdentityProviderClient cognito,
            @Value("${aws.cognito.user-pool-id:#{null}}") String userPoolId, NormaOneProperties properties) {
        this.cognito = cognito;
        this.userPoolId = userPoolId;
        this.properties = properties;
    }

    public boolean enabled() {
        return properties.getIdentity().isSyncAccountStatus() && userPoolId != null && !userPoolId.isBlank();
    }

    /**
     * Before saving a status change: re-enables the Cognito account of a person whose access comes
     * back (from SUSPENDED or DEACTIVATED to ACTIVE or INVITED). Throws IdentityProviderException
     * when Cognito cannot, so the caller saves nothing.
     */
    public void beforeSave(user target, UserStatus previous) {
        boolean restoring = (previous == UserStatus.SUSPENDED || previous == UserStatus.DEACTIVATED)
                && (target.getStatus() == UserStatus.ACTIVE || target.getStatus() == UserStatus.INVITED);
        if (!restoring || !enabled() || target.getEmail() == null) {
            return;
        }
        try {
            AdminGetUserResponse account = cognito.adminGetUser(AdminGetUserRequest.builder()
                    .userPoolId(userPoolId).username(target.getEmail()).build());
            if (account != null && Boolean.FALSE.equals(account.enabled())) {
                cognito.adminEnableUser(AdminEnableUserRequest.builder().userPoolId(userPoolId).username(target.getEmail()).build());
            }
        } catch (UserNotFoundException missing) {
            log.info("No Cognito account for user {} to re-enable; the status change goes ahead.", target.getId());
        } catch (SdkException ex) {
            throw new IdentityProviderException(
                    "Cognito could not re-enable this account, so its status was not changed. Try again later.", ex);
        }
    }

    /**
     * After saving a status change: signs a SUSPENDED or DEACTIVATED account out everywhere and
     * disables a DEACTIVATED one. Never throws; returns the outcome for the audit trail.
     */
    public String afterSave(user saved, UserStatus previous) {
        UserStatus now = saved.getStatus();
        if ((now != UserStatus.SUSPENDED && now != UserStatus.DEACTIVATED) || now == previous) {
            return null;
        }
        if (!enabled() || saved.getEmail() == null) {
            return SKIPPED;
        }
        try {
            if (now == UserStatus.DEACTIVATED) {
                cognito.adminDisableUser(AdminDisableUserRequest.builder().userPoolId(userPoolId).username(saved.getEmail()).build());
            }
            cognito.adminUserGlobalSignOut(AdminUserGlobalSignOutRequest.builder()
                    .userPoolId(userPoolId).username(saved.getEmail()).build());
            return DONE;
        } catch (UserNotFoundException missing) {
            return NO_ACCOUNT;
        } catch (SdkException ex) {
            // Access is already removed in the application; only the Cognito side is behind.
            log.warn("Cognito sign-out/disable failed for user {} ({}); the application already refuses the account.",
                    saved.getId(), ex.getClass().getSimpleName());
            return FAILED;
        }
    }
}
