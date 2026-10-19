package com.NormaOne.backend.config;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

import com.NormaOne.backend.model.notification.enums.AttachmentType;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import lombok.Data;

/**
 * Application settings under the {@code normaone.*} prefix.
 *
 * Package values seed the default plan only when it does not exist yet: they are
 * never written over an existing plan document, so administrators can change the
 * stored plan without it being reset on the next start.
 */
@Data
@ConfigurationProperties(prefix = "normaone")
public class NormaOneProperties {

    private Packages packages = new Packages();
    private Bootstrap bootstrap = new Bootstrap();
    private Onboarding onboarding = new Onboarding();
    private Auth auth = new Auth();
    private Invitations invitations = new Invitations();
    private Notifications notifications = new Notifications();
    private Attachments attachments = new Attachments();
    private Modules modules = new Modules();
    private Email email = new Email();
    private Identity identity = new Identity();

    /** How account status changes reach the identity provider (CognitoAccountAccessService). */
    @Data
    public static class Identity {
        /**
         * Mirror account status in Cognito: sign a suspended or deactivated account out everywhere,
         * disable a deactivated one, and re-enable it when it is reactivated. Needs AWS credentials
         * allowed cognito-idp:AdminUserGlobalSignOut, AdminDisableUser, AdminEnableUser and
         * AdminGetUser. Authorization never depends on it: the application refuses any account that is
         * not ACTIVE on every request, whatever Cognito says.
         */
        private boolean syncAccountStatus = true;
    }

    /**
     * Outbound email (EmailOutboxService, EmailSender). SES (the default) sends through Amazon SES with
     * the same AWS credentials as Cognito; SMTP sends through spring.mail.*. Either way a sender
     * address is required here; until there is one, emails wait in the outbox as PENDING and nothing
     * else is affected.
     */
    @Data
    public static class Email {
        public enum Provider { SES, SMTP }

        /** How email leaves the application. */
        private Provider provider = Provider.SES;

        /** SES region; blank = aws.region (the Cognito user pool's). */
        private String sesRegion;

        /**
         * Sender address (From). With SES it must be a verified identity (the address or its domain)
         * in that region. Blank = email delivery off.
         */
        private String from;

        /**
         * Who is told about plan-change requests. Empty = every ACTIVE Super Admin's email address.
         */
        private List<String> planChangeRecipients = new ArrayList<>();

        /**
         * Link to the request in the admin application, with {requestId} replaced, e.g.
         * https://admin.example.com/plan-requests/{requestId}. Blank = the email has no link.
         */
        private String planChangeReviewUrl;

        /** Attempts before an email is given up (FAILED). */
        private int maxAttempts = 5;

        /** How often PENDING emails are retried (read by EmailOutboxService's schedule). */
        private java.time.Duration retryInterval = java.time.Duration.ofMinutes(5);
    }

    /** Module access of tenant accounts. */
    @Data
    public static class Modules {
        /**
         * At startup, give tenant accounts that were never assigned modules the default assignment that
         * new accounts receive (all six modules with the role's default permissions); see
         * ModuleAccessBackfill. Off by default: it grants permissions, so an operator turns it on once,
         * deliberately. Accounts that were ever assigned modules are never touched.
         */
        private boolean backfillDefaults = false;

        /**
         * Whether a module must also be in the organization's current plan to be usable. Off for now:
         * an assigned module is available to an active account whatever the plan (BASIC included),
         * and the plan's modules are only reported. Turning this on restores plan enforcement
         * everywhere at once — ModuleAccessService is the only place that reads it.
         */
        private boolean enforcePlanEntitlement = false;
    }

    @Data
    public static class Notifications {
        /** Most recipients a SELECTED notification may have (create and update). */
        private int maxRecipients = 1000;
    }

    /** Notification attachments: where the files go and which are accepted. */
    @Data
    public static class Attachments {
        /** LOCAL for development (files on this machine's disk), S3 for production (a private bucket). */
        private StorageProvider storage = StorageProvider.LOCAL;
        /** Largest accepted file. Keep spring.servlet.multipart.max-file-size at least this large. */
        private DataSize maxSize = DataSize.ofMegabytes(10);
        /** Types accepted, decided from the file content. */
        private List<AttachmentType> allowedTypes = new ArrayList<>(List.of(AttachmentType.values()));
        private Local local = new Local();
        private S3 s3 = new S3();
    }

    @Data
    public static class Local {
        /** Directory the files are written under. Created when missing. */
        private String directory = System.getProperty("user.home") + "/.normaone/attachments";
    }

    @Data
    public static class S3 {
        /** Private bucket for the files. Required when storage=S3; never make it public. */
        private String bucket;
        /** Region of the bucket; empty means aws.region. */
        private String region;
        /** Optional prefix for every object key, e.g. "prod/". */
        private String keyPrefix = "";
        /** Lifetime of a presigned download URL. Keep it short: the URL works for anyone holding it. */
        private int downloadUrlSeconds = 60;
    }

    public enum StorageProvider { LOCAL, S3 }

    @Data
    public static class Packages {
        /** Plan code assigned to newly onboarded tenants. */
        private String defaultPlanCode = "BASIC";
        /** At startup, give the default package to existing tenants that have no package. */
        private boolean backfillExistingTenants = true;
        private Basic basic = new Basic();
    }

    @Data
    public static class Basic {
        private String code = "BASIC";
        private String name = "Basic";
        private String description = "Default free package assigned to every new organization. No payment is taken.";
        private Integer version = 1;
        /** Free: no paid pricing is defined for the default package. */
        private BigDecimal listPrice = BigDecimal.ZERO;
        private String currencyCode = "EUR";
        private BillingCycle billingCycle = BillingCycle.MONTHLY;
        /** Initial limit required by PlanDefinition.maxEmployees; change it in configuration. */
        private Long maxEmployees = 10L;
        private List<ModuleApps> moduleApps = new ArrayList<>(List.of(ModuleApps.NORMAONE));
    }

    /** Browser sessions: where the Cognito tokens live (HttpOnly cookies) and who may call cross-origin. */
    @Data
    public static class Auth {
        private Cookies cookies = new Cookies();
        /**
         * Origins allowed to call the API cross-origin WITH credentials. Empty (the default) means no
         * CORS at all: the API tester calls through its own dev-server proxy and needs none.
         */
        private List<String> corsAllowedOrigins = new ArrayList<>();
    }

    @Data
    public static class Cookies {
        /** AUTO sets Secure when the request reached the server over HTTPS; ALWAYS / NEVER force it. */
        private SecureMode secure = SecureMode.AUTO;
        /** Strict: the browser never sends the session cookie on a request started by another site. */
        private String sameSite = "Strict";
        /** Lifetime of the refresh-token cookie. Match the user pool's refresh token expiration (Cognito default: 30 days). */
        private int refreshTokenDays = 30;
        /**
         * Lifetime of the cookie holding a NEW_PASSWORD_REQUIRED challenge between login and the new
         * password. Cognito's challenge session lasts 3 minutes by default (the app client's
         * "authentication flow session duration"); match it.
         */
        private int challengeSeconds = 180;
    }

    /** How administrator-created invitations reach the invited person. */
    @Data
    public static class Invitations {
        /**
         * true: Cognito AdminCreateUser creates the account and emails a temporary password it
         * generates; the first sign-in must set a permanent one. false: no Cognito account is created
         * and the invited person registers with the invited email themselves (the earlier behaviour,
         * for environments whose AWS credentials may not call AdminCreateUser).
         */
        private boolean sendTemporaryPassword = true;
    }

    public enum SecureMode { AUTO, ALWAYS, NEVER }

    @Data
    public static class Bootstrap {
        private SuperAdmin superAdmin = new SuperAdmin();
    }

    /**
     * Explicit, server-side provisioning of a platform Super Admin (see SuperAdminBootstrap).
     * Disabled unless enabled=true and cognitoSub/email are supplied (use environment variables).
     */
    @Data
    public static class SuperAdmin {
        private boolean enabled = false;
        /** Cognito "sub" of an account that has already registered and verified its email. */
        private String cognitoSub;
        private String email;
        private String name = "Platform Administrator";
        /** How the configured sub and email are proven to be one verified Cognito account. */
        private Verification verification = Verification.COGNITO;
        /**
         * Allow provisioning when a Super Admin already exists for a different account. Off by
         * default, so a configuration left in place (or copied to another machine) cannot quietly
         * add a second platform administrator.
         */
        private boolean allowAdditional = false;
    }

    /** How SuperAdminBootstrap confirms the configured identity. Neither mode skips the check. */
    public enum Verification {
        /**
         * At startup, with Cognito AdminGetUser: the account must exist, be CONFIRMED, and have this
         * sub and this verified email. Needs AWS credentials allowed cognito-idp:AdminGetUser.
         */
        COGNITO,
        /**
         * At the account's first sign-in: provisioned when a request arrives whose validated Cognito
         * ID token has this sub, this email and email_verified=true. Needs no AWS credentials — the
         * proof is the token, whose signature, issuer and audience the resource server has checked.
         */
        TOKEN
    }

    @Data
    public static class Onboarding {
        /** A PROVISIONING tenant older than this is treated as abandoned and may be recovered by its owner. */
        private long staleProvisioningSeconds = 120;
    }
}
