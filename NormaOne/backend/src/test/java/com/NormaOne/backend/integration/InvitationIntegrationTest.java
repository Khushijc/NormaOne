package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;

import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ConfirmSignUpRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.DeliveryMediumType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ResendConfirmationCodeRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.SignUpRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserStatusType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

/**
 * Administrator-created invitations: Cognito creates the account and emails a temporary password it
 * generates; nothing here ever handles that password. Cognito is the base class's mock.
 */
class InvitationIntegrationTest extends IntegrationTestBase {

    @Autowired
    private NormaOneProperties properties;

    private String tenantA;

    @BeforeEach
    void tenantWithAdmin() throws Exception {
        properties.getInvitations().setSendTemporaryPassword(true);
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class))).thenReturn(AdminCreateUserResponse.builder().build());
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        clearInvocations(cognito);
    }

    @AfterEach
    void restore() {
        properties.getInvitations().setSendTemporaryPassword(true);
    }

    private String invite(String email, String role) throws Exception {
        String body = mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"" + email + "\",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json(body, "$.id");
    }

    /** The AdminCreateUser that sends a new invitation: Cognito generates and emails the password. */
    private static boolean isNewInvitation(AdminCreateUserRequest r, String email) {
        Map<String, String> attrs = r.userAttributes().stream().collect(Collectors.toMap(a -> a.name(), a -> a.value()));
        return email.equals(r.username())
                && r.temporaryPassword() == null                 // Cognito generates it; we never see it
                && r.messageAction() == null                     // null = send the invitation email
                && r.desiredDeliveryMediums().equals(List.of(DeliveryMediumType.EMAIL))
                && email.equals(attrs.get("email"))
                && "true".equals(attrs.get("email_verified"))    // no verification-code email
                && "Uma".equals(attrs.get("name"));
    }

    // ==================== 1, 2. a tenant admin invites ====================

    @Test
    void aTenantAdminsInvitationSendsATemporaryPasswordThroughCognito() throws Exception {
        String body = mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"Uma@A.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("INVITED"))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.invitation.delivery").value("TEMPORARY_PASSWORD"))
                .andExpect(jsonPath("$.invitation.emailSent").value(true))
                .andExpect(jsonPath("$.invitation.message").exists())
                .andReturn().getResponse().getContentAsString();

        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> isNewInvitation(r, "uma@a.test")));
        // 4. No self-registration and no verification code for an administrator-created invitation.
        verify(cognito, never()).signUp(any(SignUpRequest.class));
        verify(cognito, never()).resendConfirmationCode(any(ResendConfirmationCodeRequest.class));
        verify(cognito, never()).confirmSignUp(any(ConfirmSignUpRequest.class));

        user stored = userRepository.findById(json(body, "$.id")).orElseThrow();
        assertEquals(UserStatus.INVITED, stored.getStatus());
        assertEquals(tenantA, stored.getTenantId());
        assertNull(stored.getCognitoSub(), "linked only at the first sign-in after the password is set");
        AuditEvent audit = mongo.findOne(new Query(Criteria.where("targetId").is(stored.getId())), AuditEvent.class);
        assertEquals("TEMPORARY_PASSWORD", audit.getDetails().get("delivery"));
        assertFalse(audit.getDetails().keySet().stream().anyMatch(k -> k.toLowerCase().contains("password") && !k.equals("delivery")));
    }

    @Test
    void anInvitedAdministratorFollowsTheExistingRoleRules() throws Exception {
        String id = invite("vic@a.test", "ADMIN");
        assertTrue(userRepository.findById(id).orElseThrow().getRoles().contains(com.NormaOne.backend.model.core.enums.UserRole.ADMIN));
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> "vic@a.test".equals(r.username())));
        // Still no SUPER_ADMIN through an invitation, and nothing reaches Cognito when refused.
        clearInvocations(cognito);
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\",\"email\":\"x@a.test\",\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    // ==================== 10. after the password is set, the invitation links ====================

    @Test
    void theInvitationLinksAtTheFirstSignInAfterThePasswordChange() throws Exception {
        String id = invite("uma@a.test", "USER");
        // The ID token Cognito issues after NEW_PASSWORD_REQUIRED carries the verified email.
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(id))
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));
        user linked = userRepository.findById(id).orElseThrow();
        assertEquals(UserStatus.ACTIVE, linked.getStatus());
        assertEquals("sub-uma", linked.getCognitoSub());
        // The invited user cannot create an unrelated tenant through onboarding.
        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-uma", "uma@a.test", "Uma"))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Other", "other-org")))
                .andExpect(result -> assertTrue(result.getResponse().getStatus() == 403 || result.getResponse().getStatus() == 409));
        assertEquals(1, mongo.count(new Query(), Tenant.class));
    }

    // ==================== 3. the super admin's invitations ====================

    @Test
    void aSuperAdminsNewTenantInvitesItsInitialAdministrator() throws Exception {
        superAdmin("sub-root");
        mvc.perform(post("/api/super-admin/tenants").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationName\":\"Beta\",\"subdomain\":\"beta\",\"countryCode\":\"ES\","
                                + "\"initialAdmin\":{\"name\":\"Uma\",\"email\":\"bea@beta.test\"}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.adminInvitation.delivery").value("TEMPORARY_PASSWORD"));
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> isNewInvitation(r, "bea@beta.test")));

        String created = mvc.perform(post("/api/super-admin/admins").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + tenantA + "\",\"name\":\"Uma\",\"email\":\"nora@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.invitation.emailSent").value(true))
                .andReturn().getResponse().getContentAsString();
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> isNewInvitation(r, "nora@a.test")));
        // Creating the organization activated nobody: the administrator is INVITED until they sign in.
        assertEquals(UserStatus.INVITED, userRepository.findById(json(created, "$.id")).orElseThrow().getStatus());
    }

    // ==================== 15. Cognito failures leave nothing behind ====================

    @Test
    void aCognitoFailureRemovesTheInvitationAndTheTenant() throws Exception {
        superAdmin("sub-root");
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class))).thenThrow((CognitoIdentityProviderException)
                CognitoIdentityProviderException.builder().statusCode(400)
                        .awsErrorDetails(AwsErrorDetails.builder().errorCode("AccessDeniedException").errorMessage("not allowed").build())
                        .build());
        long users = userRepository.count();

        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"uma@a.test\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Nothing was saved")));
        mvc.perform(post("/api/super-admin/admins").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + tenantA + "\",\"name\":\"Uma\",\"email\":\"nora@a.test\"}"))
                .andExpect(status().isBadGateway());
        mvc.perform(post("/api/super-admin/tenants").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationName\":\"Beta\",\"subdomain\":\"beta\",\"countryCode\":\"ES\","
                                + "\"initialAdmin\":{\"name\":\"Uma\",\"email\":\"bea@beta.test\"}}"))
                .andExpect(status().isBadGateway());

        assertEquals(users, userRepository.count(), "no INVITED record without an email");
        assertEquals(1, mongo.count(new Query(), Tenant.class), "the failed tenant was discarded");
        assertEquals(1, mongo.count(new Query(), TenantSubscription.class));
        // And the same email can be invited again once Cognito is back.
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class))).thenReturn(AdminCreateUserResponse.builder().build());
        invite("uma@a.test", "USER");
    }

    // ==================== existing Cognito accounts and resends ====================

    @Test
    void anEmailAlreadyInCognitoIsResentOrLinkedNeverDuplicated() throws Exception {
        when(cognito.adminCreateUser(argThat((AdminCreateUserRequest r) -> r != null && r.messageAction() == null)))
                .thenThrow(UsernameExistsException.builder().message("exists").build());

        // A pending Cognito invitation (FORCE_CHANGE_PASSWORD): it is sent again, with a new temporary password.
        when(cognito.adminGetUser(any(AdminGetUserRequest.class)))
                .thenReturn(AdminGetUserResponse.builder().userStatus(UserStatusType.FORCE_CHANGE_PASSWORD).build());
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"pending@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.invitation.delivery").value("TEMPORARY_PASSWORD"));
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> r.messageAction() == MessageActionType.RESEND
                && "pending@a.test".equals(r.username())));

        // An account with its own password (CONFIRMED): nothing is sent; it links at its next sign-in.
        when(cognito.adminGetUser(any(AdminGetUserRequest.class)))
                .thenReturn(AdminGetUserResponse.builder().userStatus(UserStatusType.CONFIRMED).build());
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"confirmed@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.invitation.delivery").value("EXISTING_ACCOUNT"))
                .andExpect(jsonPath("$.invitation.emailSent").value(false));

        // The same email twice in one organization is still a 409, before Cognito is asked.
        clearInvocations(cognito);
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"confirmed@a.test\"}"))
                .andExpect(status().isConflict());
        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    @Test
    void aPendingInvitationCanBeResentAndOnlyThat() throws Exception {
        String pending = invite("uma@a.test", "USER");
        clearInvocations(cognito);
        when(cognito.adminGetUser(any(AdminGetUserRequest.class)))
                .thenReturn(AdminGetUserResponse.builder().userStatus(UserStatusType.FORCE_CHANGE_PASSWORD).build());

        mvc.perform(post("/api/tenant/users/" + pending + "/resend-invitation").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitation.delivery").value("TEMPORARY_PASSWORD"));
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> r.messageAction() == MessageActionType.RESEND));

        // Active accounts, other tenants' users and non-admins cannot.
        String adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        mvc.perform(post("/api/tenant/users/" + adminA + "/resend-invitation").with(as("sub-admin-a"))).andExpect(status().isConflict());
        onboard("sub-admin-b", "admin@b.test", "bravo");
        mvc.perform(post("/api/tenant/users/" + pending + "/resend-invitation").with(as("sub-admin-b"))).andExpect(status().isNotFound());

        // Super Admin resend for an administrator.
        superAdmin("sub-root");
        String admin = invite("vic@a.test", "ADMIN");
        mvc.perform(post("/api/super-admin/admins/" + admin + "/resend-invitation").with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitation.emailSent").value(true));
        mvc.perform(post("/api/super-admin/admins/" + pending + "/resend-invitation").with(as("sub-root"))).andExpect(status().isNotFound());
    }

    @Test
    void withTemporaryPasswordsSwitchedOffNothingReachesCognito() throws Exception {
        properties.getInvitations().setSendTemporaryPassword(false);
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"uma@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.invitation.delivery").value("SELF_REGISTRATION"))
                .andExpect(jsonPath("$.invitation.emailSent").value(false));
        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }
}
