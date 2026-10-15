# GitHub hardening recommendations

Read-only public API evidence on 2026-10-10: repository public, default main;
release/revendasmart-rc1-integrated protected=false; visible rulesets=[].
Private vulnerability reporting and account-level settings were not verified.
No administrative settings were changed.

Before publishing the candidate, the owner should apply a ruleset to main and release/**:
require pull requests and owner review; require CODEOWNERS approval; prohibit force push
and branch deletion; restrict bypass to a documented emergency procedure; dismiss stale
approvals and require checks against the actual merge candidate.

Require validated checks: CodeQL/codeql, Dependency Review/dependency-review,
Security Final/local-gates, Security Final/static-analysis, Quality Gates/quality.
First execute them on the actual candidate and verify their final job names in GitHub.
Do not set checks as required based only on guessed names or unexecuted configuration.
Scorecard initially reports governance gaps; its score is not proof of application safety.

Enable dependency graph, Dependabot alerts/security updates, secret scanning and push
protection where GitHub makes them freely available. Enable private vulnerability
reporting so SECURITY.md has a working disclosure channel. Keep Actions default token
permissions read-only, disallow untrusted workflow execution with secrets, and review
Dependabot Action pin updates against the official upstream commit and release.

Historical suspected credentials require a private rotation/revocation review and
verification of every consuming service. Rewriting Git history is not a substitute for
rotation and is outside this task's authorization. No real secret may be allowlisted.
