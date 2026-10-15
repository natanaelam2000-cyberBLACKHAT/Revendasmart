# ADS-PRO — entrega final auditada

Branch: `codex/ads-pro-finalize-2026-10-07`.
Base da implementação: `4e8417347764e0e4449f6fa0f10d0454a5edc631`.

## Biblioteca congelada

309 fontes JPEG auditadas, 300 aprovadas e nove exclusões documentadas: quatro duplicatas exatas, quatro visuais e uma exclusão de curadoria. Runtime: 300 WebP principais e 300 thumbnails. Zero corrompidos, referências ausentes, órfãos ou conflitos de case. Os hashes dos 600 WebP, manifest, curadoria, inventário e lockfile foram preservados.

Decisões individuais e medições permanentes: `docs/ads-pro/background-audit/`. Curadoria e inventário: `source-assets/ads-pro-backgrounds/`. Os JPEG originais ficam locais e ignorados; não são distribuídos no runtime.

## Validação concluída

Typecheck, lint, teste da biblioteca real, build completo via SUBST, E2E F1–F21 (celular e desktop, sem chamadas pagas), Capacitor sync e assembleDebug passaram. A validação isolada e no navegador confirmou um provider e uma instância React com `RS_BUILD_PRESERVE_SYMLINKS=true`. O opt-in é destinado à validação Windows via alias; o comportamento padrão permanece desativado.

JDK 21.0.10, Gradle 8.14.3. APK debug verificado antes deste fechamento de versionamento: SHA-256 `044f9b31e316119a29af25973fa1022b8ae7d9c8623d91dcf1ea741a34dc20c8`. Seus 782 arquivos web correspondiam por hash ao sync, incluindo os 600 WebP. A proveniência registrou branch, HEAD base e a worktree com as alterações auditadas. APK, dist, logs e caches não pertencem ao commit.

O harness libera o cache libvips antes de remover fixtures, corrigindo o EPERM de cleanup. Mutation runners usam Node/tsx local sem shell e preservam restauração das fixtures. O tooling Android mantém um alias SUBST somente quando corresponde à mesma raiz física Git.

## Auditoria final

Aprovada para integração: zero CRITICAL/HIGH no escopo ADS-PRO. Nenhuma mudança de dependências; o lockfile foi preservado. Caminhos de upload derivam do UID autenticado e IDs restritos. Histórico/perfil e gravações são tenant-scoped; PNGs finais têm leitura pública por decisão explícita de Storage Rules.

Observações não bloqueantes: avaliar privacidade dos PNGs públicos e memória em Android com pouca RAM; a paginação acumula thumbnails, o cache de fotos mantém até oito canvases e o carregamento de imagens não tem timeout próprio. Offline web é parcial; manifest estruturalmente inválido falha fechado. APK debug/empacotamento foram validados, sem execução de plugins nativos em aparelho físico nesta etapa. O fallback legado de admin e o inventário global de CVEs são assuntos de manutenção separados.

A falha global “Referral frontend sends a Firebase ID token and never trusts a client UID” permanece `PREEXISTING_OUT_OF_SCOPE`, sem relação com ADS-PRO. Nenhuma produção foi alterada para satisfazer essa asserção.

Esta entrega não faz deploy de regras, merge, push ou publicação de release Android. Relatórios intermediários com bloqueios antigos não representam o estado final.
