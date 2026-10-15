# Security policy

## Supported versions

Security fixes target the current release candidate on `release/revendasmart-rc1-integrated`
and the maintained production release. Older snapshots and experimental branches are not
supported. Confirm the deployed version before applying a fix; a branch name alone is not
release evidence.

## Responsible disclosure

Do not disclose vulnerabilities, tokens, customer records or exploit details in public Issues,
pull requests or discussions. Use the repository Security tab → Advisories → Report a
vulnerability: https://github.com/natanaelam2000-cyberBLACKHAT/Revendasmart/security/advisories/new
The owner must enable private vulnerability reporting if this entry point is unavailable.
Until a private channel is available, retain the report privately; do not post sensitive
information publicly. No unverified contact address is offered here.

Include affected version/commit, impact, minimal reproduction using synthetic data, expected
and actual behavior, and a suggested fix. Never attack production or attach secret values.

The repository owner triages privately, acknowledges receipt, checks severity and affected
releases, reproduces using local emulators, prepares a small fix with regression coverage,
and coordinates a release and advisory with the reporter. Response times depend on owner
availability; this policy does not promise an unverified SLA. A suspected exposed credential
requires revocation/rotation and a private incident investigation before release approval.
