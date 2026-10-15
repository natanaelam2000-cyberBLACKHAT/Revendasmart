# Storage Rules matrix — 2026-10-10

| PATH | READ | CREATE | UPDATE | DELETE | CLIENT_WRITE_ALLOWED | SERVER_WRITE_ONLY | OWNER_CHECK | MIME/SIZE RULE | TEST |
|---|---|---|---|---|---|---|---|---|---|
| `users/{uid}/products/**` | public by catalog contract | no | no | no | no | yes | server UID | server magic bytes/dimensions/quota | upload-hardening |
| `users/{uid}/product-thumbnails/{productId}/*` | public by catalog contract | no | no | no | no | yes | server UID | JPEG/WebP, dimensions/quota | upload/source |
| `users/{uid}/product-cutouts/{productId}/cutout-v1.png` | public by product contract | no | no | no | no | yes | server PNG validation | upload/source |
| `users/{uid}/branding/**` | public branding contract | no | no | no | no | yes | server image validation | upload/source |
| `users/{uid}/promotional-campaigns/**` | public campaign page | no | no | no | no | yes | server image validation | promotional tests |
| `users/{uid}/marketing-pro-backgrounds/**` | public Ads Pro asset | no | no | no | no | yes | server validation | source (Ads Pro out of scope) |
| `users/{uid}/marketing-pro-ads/**` | public Ads Pro history | no | no | no | no | yes | server PNG validation | source (Ads Pro out of scope) |
| all other paths | no | no | no | no | no | n/a | n/a | n/a | catch-all |

Upload routes derive the UID from the verified Firebase token, reject path separators
and oversized IDs, validate magic bytes/dimensions and enforce per-user quota. The
client cannot delete an arbitrary path; deletion accepts only a canonical path derived
from the authenticated UID, kind and target ID. SVG is not an accepted upload format.
Storage Rules cannot inspect bytes, so byte validation remains server-side.
