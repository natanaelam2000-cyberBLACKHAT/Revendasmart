# Validação Manual — Fase 2 (Ownership com Tokens Reais)

Como a página interativa está causando problemas de startup, esta é a validação MANUAL guiada que você deve executar para comprovar os 4 cenários com tokens Firebase reais.

## Setup Inicial

1. **Abra a aplicação em um navegador**
   - URL: http://localhost:5173 (ou outra porta Replit)
   - A aplicação deve estar rodando em desenvolvimento

2. **Abra DevTools (F12)**
   - Vá à aba **Console**
   - Mantenha aberta para ver requisições de rede

## Cenário 1: GET próprio user com token válido

### Passos:
1. **Faça login com uma conta de teste (ex: alice@test.com)**
   - Se não tiver, crie uma conta via signup
   - Confirme que o onboarding está completo

2. **Na Console do DevTools, execute:**
   ```javascript
   // Obter token real do usuário autenticado
   const user = firebase.auth().currentUser;
   const token = await user.getIdToken();
   
   // Registre o token e UID
   console.log("User UID:", user.uid);
   console.log("Token:", token);
   
   // Fazer requisição GET para o próprio UID
   const response = await fetch(`/api/user/settings/${user.uid}`, {
     method: "GET",
     headers: {
       "Authorization": `Bearer ${token}`,
       "Content-Type": "application/json"
     }
   });
   
   console.log("Status:", response.status);
   console.log("Response:", await response.json());
   ```

### Resultado Esperado:
- **HTTP Status: 200**
- **Body:** `{"onboarding_completed": true, "settings": {...}}`
- **Interpretação:** ✅ Usuário consegue ler seus próprios dados

### Evidência Observada:
```
Status: [ANOTAR AQUI]
Response: [ANOTAR AQUI]
```

---

## Cenário 2: GET outro user com token válido

### Passos:
1. **Abra uma aba incógnito/privada**
   - URL: http://localhost:5173
   - Crie OUTRA conta (ex: bob@test.com)
   - Registre o UID de bob: `[BOB_UID]`
   - Faça logout de bob (volte ao login)

2. **Volte à aba original (alice) e execute na Console:**
   ```javascript
   // Usar token de alice para tentar acessar dados de bob
   const user = firebase.auth().currentUser; // alice
   const token = await user.getIdToken();
   const bobUid = "[BOB_UID]"; // Substitua pelo UID real de bob
   
   const response = await fetch(`/api/user/settings/${bobUid}`, {
     method: "GET",
     headers: {
       "Authorization": `Bearer ${token}`,
       "Content-Type": "application/json"
     }
   });
   
   console.log("Status:", response.status);
   console.log("Response:", await response.json());
   ```

### Resultado Esperado:
- **HTTP Status: 403** (Forbidden)
- **Body:** `{"error": "Forbidden: no ownership"}`
- **Interpretação:** ✅ Alice NÃO consegue ler dados de Bob

### Evidência Observada:
```
Status: [ANOTAR AQUI]
Response: [ANOTAR AQUI]
```

---

## Cenário 3: POST próprio user com token válido

### Passos:
1. **Na aba de alice, execute na Console:**
   ```javascript
   const user = firebase.auth().currentUser;
   const token = await user.getIdToken();
   
   const response = await fetch(`/api/user/settings/${user.uid}`, {
     method: "POST",
     headers: {
       "Authorization": `Bearer ${token}`,
       "Content-Type": "application/json"
     },
     body: JSON.stringify({
       onboarding_completed: true
     })
   });
   
   console.log("Status:", response.status);
   console.log("Response:", await response.json());
   ```

### Resultado Esperado:
- **HTTP Status: 200** (ou 204 conforme implementação)
- **Body:** `{"success": true, "onboarding_completed": true}`
- **Interpretação:** ✅ Alice consegue escrever seus próprios dados

### Evidência Observada:
```
Status: [ANOTAR AQUI]
Response: [ANOTAR AQUI]
```

---

## Cenário 4: POST outro user com token válido

### Passos:
1. **Na aba de alice, execute na Console:**
   ```javascript
   const user = firebase.auth().currentUser; // alice
   const token = await user.getIdToken();
   const bobUid = "[BOB_UID]"; // Substitua pelo UID real de bob
   
   const response = await fetch(`/api/user/settings/${bobUid}`, {
     method: "POST",
     headers: {
       "Authorization": `Bearer ${token}`,
       "Content-Type": "application/json"
     },
     body: JSON.stringify({
       onboarding_completed: false
     })
   });
   
   console.log("Status:", response.status);
   console.log("Response:", await response.json());
   ```

### Resultado Esperado:
- **HTTP Status: 403** (Forbidden)
- **Body:** `{"error": "Forbidden: no ownership"}`
- **Interpretação:** ✅ Alice NÃO consegue escrever dados de Bob

### Evidência Observada:
```
Status: [ANOTAR AQUI]
Response: [ANOTAR AQUI]
```

---

## Tabela de Validação

| Cenário | Método | Esperado | Observado | Comprovado |
|---------|--------|----------|-----------|-----------|
| 1. GET próprio user | GET | 200 | ? | ☐ |
| 2. GET outro user | GET | 403 | ? | ☐ |
| 3. POST próprio user | POST | 200 | ? | ☐ |
| 4. POST outro user | POST | 403 | ? | ☐ |

---

## Critério de Sucesso

**Fase 2 está realmente concluída quando:**

- ✅ Cenário 1: HTTP 200 (alice lê seus dados)
- ✅ Cenário 2: HTTP 403 (alice não consegue ler dados de bob)
- ✅ Cenário 3: HTTP 200 (alice escreve seus dados)
- ✅ Cenário 4: HTTP 403 (alice não consegue escrever dados de bob)

Se todos os 4 cenários retornam o HTTP esperado → **Ownership está COMPROVADO com tokens reais**

---

## Observações Importantes

1. **BOB_UID:** Você obtém este valor fazendo login como bob e anotando o UID na console
2. **Token Real:** `firebase.auth().currentUser.getIdToken()` gera um token real do Firebase
3. **Segurança:** Não compartilhe esses tokens em público
4. **Firestore:** Os dados podem levar alguns segundos para sincronizar

## Próxima Ação

Após completar esta validação manualmente, você terá EVIDÊNCIA REAL (não inferência) de que:
- Autenticação obrigatória está funcionando
- Ownership está sendo validado
- Segurança está em place

Então você pode prosseguir para **Fase 3: Recuperação de Dados Antigos** com confiança.
