# Local SBOM artifacts

`revendasmart.cdx.json` is generated and ignored. It was produced by Syft 1.54.1,
CycloneDX 1.7, from the audited npm lockfile; 521 components. Generation time is in
its metadata.timestamp. Base SHA 60f6226596d1156785b3a39b62a16580d4beb229;
source changes remain uncommitted, so this is not a signed final-release attestation.

Reproduce: `syft scan dir:. --override-default-catalogers javascript-lock-cataloger
-o cyclonedx-json=.tmp/security/sbom.cdx.json`. CI stores the generated JSON as an
artifact. Never commit regenerated SBOM noise or secret-bearing scanner logs.
