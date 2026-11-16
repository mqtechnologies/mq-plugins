# Atualizações da interface do MQ Creator

Cada edição (`pro`, `free`, `junior`) tem a sua pasta:

- `pending.json` — a versão nova, ainda **sem assinatura** (enviada a partir do repositório privado).
- `test.json` + `test.sig` — versão de **testes** assinada (só a recebem as instalações com código de testes).
- `stable.json` + `stable.sig` — versão **estável** assinada (todas as escolas).
- `stable-prev.json` — a estável anterior (para «voltar atrás»).
- `p/` — as partes, cifradas; o nome de cada uma é o seu hash.

A assinatura é feita pelas Actions deste repositório com o segredo `MQ_SIGN_KEY`:

- **Assinar testes** corre sozinho quando chega um `pending.json` novo.
- **Publicar estável** corre-se à mão (Actions › Publicar estável › Run workflow): `publicar` passa a versão de testes a estável; `voltar-atras` faz todas as instalações voltarem à estável anterior.

`policy.json` (opcional): `{"keys": [chaves públicas aceites a partir daqui], "revoked": [ids de códigos de testes anulados]}`.
