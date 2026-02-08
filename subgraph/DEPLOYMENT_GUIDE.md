 # Guía de Deployment: Subgraph para CundinaBlock
 
 ## Prerequisitos
 
 1. **Node.js 18+** instalado
 2. **Graph CLI** instalado globalmente:
    ```bash
    npm install -g @graphprotocol/graph-cli
    ```
 3. **Cuenta en The Graph** (https://thegraph.com/studio)
 
 ---
 
 ## Paso 1: Crear el Subgraph en Studio
 
 1. Ve a https://thegraph.com/studio
 2. Conecta tu wallet (MetaMask)
 3. Click "Create a Subgraph"
 4. Nombre: `cundinablock-v1`
 5. Network: `Sepolia`
 6. Anota el **Deploy Key** que te da
 
 ---
 
 ## Paso 2: Preparar Archivos
 
 ### Estructura del directorio:
 
 ```
 subgraph/
 ├── schema.graphql          # ✅ Ya existe
 ├── subgraph.yaml           # ✅ Ya existe
 ├── src/
 │   ├── registry.ts         # ✅ Ya existe
 │   └── block.ts            # ✅ Ya existe
 ├── abis/
 │   ├── BlockRegistryFactory.json    # ⚠️ CREAR
 │   └── CundinaBlockSecure.json      # ⚠️ CREAR
 └── package.json            # ⚠️ CREAR
 ```
 
 ### 2.1 Crear package.json
 
 ```bash
 cd subgraph
 npm init -y
 npm install @graphprotocol/graph-ts @graphprotocol/graph-cli
 ```
 
 ### 2.2 Extraer ABIs del contrato
 
 Después de compilar `BlockRegistryFactory_V4.sol` en Remix:
 
 1. En Remix, ve a "Compilation Details"
 2. Copia el ABI de `BlockRegistryFactory`
 3. Guárdalo en `subgraph/abis/BlockRegistryFactory.json`
 4. Repite para `CundinaBlockSecure`
 
 **ABI mínimo requerido para BlockRegistryFactory:**
 
 ```json
 [
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "user", "type": "address"},
       {"indexed": true, "name": "referrer", "type": "address"},
       {"indexed": false, "name": "level", "type": "uint256"}
     ],
     "name": "UserRegistered",
     "type": "event"
   },
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "center", "type": "address"},
       {"indexed": true, "name": "level", "type": "uint256"},
       {"indexed": false, "name": "blockAddress", "type": "address"}
     ],
     "name": "MyBlockCreated",
     "type": "event"
   },
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "wallet", "type": "address"},
       {"indexed": true, "name": "code", "type": "bytes32"}
     ],
     "name": "ReferralCodeGenerated",
     "type": "event"
   },
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "user", "type": "address"},
       {"indexed": true, "name": "referrer", "type": "address"}
     ],
     "name": "ReferralChainCreated",
     "type": "event"
   },
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "blockAddr", "type": "address"},
       {"indexed": false, "name": "newCount", "type": "uint256"}
     ],
     "name": "InviteCountUpdated",
     "type": "event"
   }
 ]
 ```
 
 **ABI mínimo para CundinaBlockSecure:**
 
 ```json
 [
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "member", "type": "address"},
       {"indexed": true, "name": "position", "type": "uint256"},
       {"indexed": false, "name": "amount", "type": "uint256"}
     ],
     "name": "MemberJoined",
     "type": "event"
   },
   {
     "anonymous": false,
     "inputs": [
       {"indexed": true, "name": "completedAt", "type": "uint256"}
     ],
     "name": "BlockCompleted",
     "type": "event"
   }
 ]
 ```
 
 ---
 
 ## Paso 3: Actualizar subgraph.yaml
 
 Actualiza la dirección del Registry con la nueva V4:
 
 ```yaml
 source:
   address: "0xNUEVA_DIRECCION_REGISTRY_V4"
   startBlock: NUMERO_DE_BLOQUE_DEPLOYMENT
 ```
 
 ---
 
 ## Paso 4: Generar Código TypeScript
 
 ```bash
 cd subgraph
 graph codegen
 ```
 
 Esto genera `generated/` con tipos TypeScript para:
 - Eventos
 - Entidades
 - Contratos
 
 ---
 
 ## Paso 5: Compilar
 
 ```bash
 graph build
 ```
 
 Valida que no haya errores de compilación.
 
 ---
 
 ## Paso 6: Autenticar
 
 ```bash
 graph auth --studio YOUR_DEPLOY_KEY
 ```
 
 ---
 
 ## Paso 7: Deploy
 
 ```bash
 graph deploy --studio cundinablock-v1
 ```
 
 Cuando pregunte la versión, usa: `0.0.1`
 
 ---
 
 ## Paso 8: Verificar
 
 1. Ve a https://thegraph.com/studio/subgraph/cundinablock-v1
 2. Espera a que sincronice (puede tomar minutos/horas dependiendo del startBlock)
 3. Prueba queries en el Playground:
 
 ```graphql
 {
   users(first: 10) {
     id
     level
     referralCode
     blocks {
       id
       levelId
       status
     }
   }
 }
 ```
 
 ---
 
 ## Paso 9: Actualizar Frontend
 
 Una vez desplegado, actualiza `src/config/subgraph.ts`:
 
 ```typescript
 export const SUBGRAPH_CONFIG = {
   URL: "https://api.studio.thegraph.com/query/YOUR_ID/cundinablock-v1/version/latest",
   // ...
 };
 ```
 
 ---
 
 ## Troubleshooting
 
 ### Error: "Entity not found"
 - Verifica que el startBlock sea ANTES del deployment del contrato
 - Revisa que la dirección del contrato sea correcta
 
 ### Error: "Mapping aborted"
 - Revisa los logs en Studio para ver qué transacción falló
 - Puede ser un evento con datos inesperados
 
 ### Subgraph no sincroniza
 - Verifica que el RPC de Sepolia esté respondiendo
 - Revisa que los ABIs coincidan exactamente con el contrato desplegado
 
 ---
 
 ## Comandos Útiles
 
 ```bash
 # Regenerar tipos después de cambiar schema
 graph codegen
 
 # Build local sin deploy
 graph build
 
 # Ver logs del indexer
 # (solo disponible en Studio después del deploy)
 
 # Crear desde template
 graph init --studio cundinablock-v1
 ```
 
 ---
 
 ## Notas de Producción
 
 Para mainnet:
 
 1. Cambiar `network: sepolia` → `network: mainnet` en subgraph.yaml
 2. Actualizar la dirección del contrato
 3. Considerar The Graph Network (descentralizado) en lugar de Hosted Service
 4. Agregar rate limiting y caché en el frontend