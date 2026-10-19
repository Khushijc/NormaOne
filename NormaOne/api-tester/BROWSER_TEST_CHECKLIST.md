# NormaOne — manual browser checklist (Super Admin, Tenant Admin, USER)

The API tester has no end-to-end framework (its scripts are `lint`, `test` — a server-rendered smoke
test of the screens — and `build`). Mocked smoke checks and backend integration tests do not prove the
browser, the real backend, Cognito and email work together, so run this list against the **real**
backend (`http://localhost:8881`, restarted after the latest backend changes) and the tester
(`npm run dev`, `http://localhost:1500`).

Record each line as **pass / fail / blocked** with the response status the tester shows (every call
opens in the response panel with its method, path and status).

## 0. Setup

| Account | Role | How |
|---|---|---|
| **SA1** | Super Admin | the bootstrap Super Admin |
| **SA2** | Super Admin | added in section 4 |
| **TA** | Tenant Admin, organization **A** | a self-registered owner (e.g. rohayes871@…) |
| **TB** | Tenant Admin, organization **B** | another owner |
| **UA** | USER in organization A | invited by TA in section 2 |

Have ready: organization A's id and B's id (Super admin › Tenants), and one user id from B (Super admin › Users).
Use one browser profile per account, or sign out between steps (top bar › Session).

## 1. Access by role (who reaches what)

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 1.1 | USER (UA) | open Tenant admin › Users, Plans, Audit log | every call **403**; no data shown |
| 1.2 | USER (UA) | open Super admin › Plans, Audit, Super Admins | **403** |
| 1.3 | TA | open Super admin › Plans, Plan history, Change requests, Super Admins, Audit | **403** |
| 1.4 | SA1 | open Tenant admin › Plans, Audit log | **403** (a platform account has no organization) |
| 1.5 | signed out | any screen above | **401** |

## 2. Cross-tenant ID manipulation (Workbench › Console, signed in as TA)

| # | Request | Expect |
|---|---|---|
| 2.1 | `GET /api/tenant/users/{a user id of B}` | **404** |
| 2.2 | `PATCH /api/tenant/users/{a user id of B}/status` `{"status":"DEACTIVATED","reason":"x"}` | **404**; the B user is unchanged (check as TB) |
| 2.3 | `GET /api/tenant/audit-events?tenantId={B's id}` | **200**, every row's `tenantId` is **A's** |
| 2.4 | `POST /api/tenant/plan-change-requests` `{"planId":"…","tenantId":"{B's id}"}` | **201**, `organization.id` is **A's** (then cancel it, 3.6) |
| 2.5 | as TB: `GET` and `POST …/cancel` on A's request id | **404** |

## 3. Plans and plan-change requests

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 3.1 | SA1 | Super admin › Plans › Create a plan (e.g. code `TEAM`, price 19, seats 3, duration 12, two modules) | **201**, status DRAFT |
| 3.2 | SA1 | open it › Edit price › Save; then Activate (confirm dialog) | **200** each; Plan history shows PLAN_UPDATED with old → new price and PLAN_STATUS_CHANGED DRAFT → ACTIVE |
| 3.3 | SA1 | on the ACTIVE plan, change the price | **409** "not changed in place"; New version creates v2 as DRAFT |
| 3.4 | TA | Tenant admin › Plans | every plan listed; ACTIVE non-current ones have **Request this plan**; DRAFT/INACTIVE say "Cannot be requested"; the current one is outlined; seats "used of limit" under Current subscription |
| 3.5 | TA | Request `TEAM` (confirm dialog, reason) | **201** PENDING; green banner; the open-request banner appears; Request buttons disabled |
| 3.6 | TA | Cancel the request (confirm) | **200** CANCELLED |
| 3.7 | TA | request again; as SA1 open Super admin › Plans › Change requests › the request | listed PENDING with organization, plans, requester, email status |
| 3.8 | SA1 | Reject with an empty note | button stays disabled (backend would answer **400**) |
| 3.9 | SA1 | Reject with a note (confirm) | **200** REJECTED; TA sees the note under Requests; plan unchanged |
| 3.10 | TA → SA1 | request again; Approve and apply (confirm) | **200** APPROVED; TA's Current subscription is the new plan with its term end; Plan history shows REQUESTED, APPROVED, TENANT_PLAN_CHANGED with the same request id |
| 3.11 | SA1 | Approve the same request again (Console) | **409** |
| 3.12 | SA1 | deactivate a plan an organization is on (confirm) | **200**; "Organizations on this plan" still lists it; TA still sees it as current, INACTIVE, not requestable |

## 4. Super Admins

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 4.1 | SA1 | Super Admins › Add (name, email of a real inbox) | **201** INVITED; the response has no password; the invitee receives Cognito's temporary-password email (**real Cognito**) |
| 4.2 | SA1 | add the same email again; add TA's email | **409** both |
| 4.3 | SA2 | sign in with the temporary password, set a new one | lands on the Super Admin dashboard |
| 4.4 | SA1 | open own account in Super Admins | "This is your own account" — no status controls |
| 4.5 | SA1 | remove SA2 (Make DEACTIVATED, reason, confirm) | **200**; SA2's next request **403**; SA2 can no longer sign in (Cognito disabled — needs the IAM permissions in docs §14, else audit says identityProvider FAILED) |
| 4.6 | SA1 | restore SA2 (Make ACTIVE) | **200**; SA2 signs in again |
| 4.7 | SA1 + SA2, two browsers | each opens the other's page and confirms removal at the same moment | at most one **200**; at least one Super Admin stays ACTIVE (Super Admins list, filter ACTIVE) |

## 5. Deactivation, reactivation and seats

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 5.1 | TA | Users › invite UA; UA signs in | UA ACTIVE |
| 5.2 | TA | UA › Make DEACTIVATED (confirm) | **200**; UA's next request **403**; UA cannot sign in (Cognito disabled) |
| 5.3 | TA | UA › Make ACTIVE | **200**; UA signs in again |
| 5.4 | TA | own account › change status | **403** "your own status" |
| 5.5 | SA1 | Administrators › TA › Make DEACTIVATED **without** the acknowledgement | **409** "only active administrator" |
| 5.6 | SA1 | move A to the 3-seat plan (Tenants › A › Change the plan); TA invites until 3 seats are used | the 4th invitation **409** "allows 3 user seats"; pending invitations count |
| 5.7 | TA | deactivate one account, invite again | **201** (the seat was freed) |

## 6. Audit-log filters

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 6.1 | TA | Audit log, Action = USER_STATUS_CHANGED | only status changes of organization A |
| 6.2 | TA | From = a future date | 0 events |
| 6.3 | TA | From later than To (Console) | **400** |
| 6.4 | TA | Action = PLAN_CHANGE_REQUESTED | the requests from section 3 |
| 6.5 | SA1 | Super admin › Audit, tenantId = A, Action = PLAN_CHANGE_APPROVED | the approval from 3.10 |

## 6b. Email-notification preferences

| # | Signed in as | Do | Expect |
|---|---|---|---|
| 6b.1 | UA (USER) | Account › Profile › Email notifications: switch off | spinner, then "Saved", **Disabled**; reload the page: still Disabled |
| 6b.2 | TA | Tenant admin › Users: UA's row shows **Disabled**; switch it on | "Saved"; UA's profile shows Enabled |
| 6b.3 | TA | an ADMIN's row in Users, and TA's own row | "Own setting" — no switch; TA changes their own under Account › Profile |
| 6b.4 | TA (Console) | `PUT /api/tenant/users/{a user id of B}/email-preference` `{"enabled":false}` | **404**; B's user unchanged |
| 6b.5 | TA (Console) | the same route with another ADMIN's id, or TA's own id | **403** |
| 6b.6 | UA (Console) | `PUT /api/tenant/users/{any id}/email-preference` | **403**; `PUT /api/users/me/email-preference` with another `userId` in the body changes only UA |
| 6b.7 | SA1 | Account › Profile › Email notifications | the switch works for SA1's own account; the tenant route answers **403** |
| 6b.8 | backend stopped, then any switch | — | an error under the switch; it stays on its previous value |
| 6b.9 | any | every preference card | "Email delivery — Coming Soon … saved now and applies once email is available" |

## 7. Email — "Coming Soon"

Email delivery is not configured yet, and the tester says so (`EMAIL_DELIVERY_AVAILABLE = false` in `src/config/features.js`):

| # | Do | Expect |
|---|---|---|
| 7.0a | Notifications › Send a notification (TA or SA1) | Delivery: **In-app** and **Email — Coming Soon**, with "Email notifications are coming soon. Recipients will continue to receive in-app notifications."; the notification is sent and appears in the recipients' inbox and unread count |
| 7.0b | TA requests a plan | **201** PENDING; the banner and Available plans show **Email Notifications — Coming Soon**; no email status is shown |
| 7.0c | SA1 › Change requests (list and one request) | the email column and the request's "Super Admin email" show **Coming Soon**, never SENT; approve and reject work as in section 3 |

### Real delivery (later)

Only once email is configured (`NORMAONE_EMAIL_FROM` with SES or SMTP, docs §13 "Email notifications") and `EMAIL_DELIVERY_AVAILABLE` is set to `true`:

| # | Do | Expect |
|---|---|---|
| 7.1 | TA requests a plan | the Super Admins receive one email with the organization, requester, both plans' terms, time, status and reason; the request shows email **SENT** |
| 7.2 | stop email (e.g. a wrong SMTP host), request again | request **201** and kept; email **PENDING** with the error (Super Admin view); after fixing the configuration it is sent by the retry within `normaone.email.retry-interval` |

Until then the backend keeps the queued email as **PENDING** "not configured" (visible in the raw API response) — expected, and the request is still saved.
