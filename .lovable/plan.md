
# Plan de Migración: Arquitectura 100% On-Chain

## Resumen Ejecutivo

Este plan detalla la migración completa del sistema CundinaBlock desde una arquitectura híbrida (Supabase + Blockchain) hacia una arquitectura **100% on-chain**, eliminando la dependencia de la base de datos para wallets, bloques y referidos.

---

## Fase 1: Análisis del Estado Actual

### Datos Actualmente en Supabase (a migrar)

| Tabla | Datos | Uso Actual |
|-------|-------|-----------|
| `user_wallets` | Direcciones, códigos de referido, `referred_by_wallet_id` | Mapeo wallet-usuario, resolución de referidos |
| `blocks` | Metadatos de bloques, `contract_address`, contadores | Dashboard, Ranking, historial |
| `block_members` | Membresías wallet-bloque con posición | Tracking de participación |
| `user_level_progress` | Estado por nivel (locked/active/completed) | Control de progresión |
| `transactions` | Historial de pagos y retiros | Auditoría |
| `ranking_positions` | Historial de posiciones en ranking | Tendencias UI |

### Datos Ya Disponibles On-Chain

| Contrato | Función | Datos |
|----------|---------|-------|
| `BlockRegistryFactory` | `userLevel(address)` | Nivel actual del usuario |
| `BlockRegistryFactory` | `myBlockAtLevel(address, level)` | Dirección del bloque propio por nivel |
| `BlockRegistryFactory` | `inviteSlots(address)` | Slots de invitación acumulados |
| `CundinaBlockSecure` | `getMembers()` | Lista de miembros del bloque |
| `CundinaBlockSecure` | `membersCount()` | Conteo de miembros |
| `CundinaBlockSecure` | `status()` | 0=Active, 1=Completed |
| `CundinaBlockSecure` | `owner()` | Creador del bloque |

### Gap Analysis: Datos Faltantes On-Chain

1. **Códigos de Referido**: No existe mapeo `código → wallet` on-chain
2. **Cadena de Referidos**: No hay `mapping(address => address) referrerOf`
3. **Contador de Invitados por Bloque**: Existe `inviteSlots` pero no por bloque específico
4. **Historial de Transacciones**: Solo disponible vía eventos (requiere indexer)
5. **Perfiles de Usuario**: Nombres, teléfonos, contactos (no migrables 100% on-chain)

---

## Fase 2: Cambios en Smart Contracts

### 2.1 Nuevas Estructuras en BlockRegistryFactory

```text
Agregar al contrato existente:

+--------------------------------------------+
| NUEVOS MAPPINGS                            |
+--------------------------------------------+
| referralCodeToWallet: bytes32 → address    |
| walletToReferralCode: address → bytes32    |
| referrerOf: address → address              |
| invitedCountByBlock: address → uint256     |
+--------------------------------------------+
```

### 2.2 Nuevas Funciones del Registry

```solidity
// Generar código de referido automático (hash de wallet + salt)
function generateReferralCode(address wallet) internal returns (bytes32);

// Registrar código personalizado (opcional, pago extra)
function setCustomReferralCode(bytes32 code) external;

// Resolver código a wallet (view function para frontend)
function resolveReferralCode(bytes32 code) external view returns (address);

// Obtener código de una wallet
function getReferralCode(address wallet) external view returns (bytes32);

// Obtener referidor de una wallet
function getReferrer(address wallet) external view returns (address);

// Obtener todos los bloques de un usuario (para Dashboard)
function getAllUserBlocks(address user) external view returns (address[] memory);

// Obtener conteo de invitados por bloque
function getInvitedCount(address blockAddr) external view returns (uint256);
```

### 2.3 Modificaciones a registerUser

```solidity
function registerUser(address user, address referrer, uint256 level) external {
    // ... lógica existente ...
    
    // NUEVO: Almacenar cadena de referidos
    if (referrer != address(0)) {
        referrerOf[user] = referrer;
    }
    
    // NUEVO: Generar código de referido automático
    if (walletToReferralCode[user] == bytes32(0)) {
        bytes32 code = keccak256(abi.encodePacked(user, block.timestamp, blockhash(block.number - 1)));
        referralCodeToWallet[code] = user;
        walletToReferralCode[user] = code;
        emit ReferralCodeGenerated(user, code);
    }
    
    // NUEVO: Incrementar contador del bloque del referidor
    if (referrer != address(0)) {
        uint256 refLevel = userLevel[referrer];
        if (refLevel >= 2) {
            address refBlock = myBlockAtLevel[referrer][refLevel];
            invitedCountByBlock[refBlock] += 1;
        }
    }
}
```

### 2.4 Nuevos Eventos para Indexación

```solidity
event ReferralCodeGenerated(address indexed wallet, bytes32 indexed code);
event ReferralChainCreated(address indexed user, address indexed referrer);
event InviteCountUpdated(address indexed blockAddr, uint256 newCount);
```

---

## Fase 3: Implementar Indexador de Eventos

### 3.1 Opciones de Indexador

| Opción | Pros | Contras |
|--------|------|---------|
| **The Graph** | Estándar de industria, descentralizado | Costo por queries, setup complejo |
| **Alchemy Subgraphs** | Integrado con Alchemy, fácil setup | Vendor lock-in |
| **Goldsky** | Muy rápido, buen soporte | Menos maduro |
| **Indexador Propio (Edge Function)** | Control total, sin costos externos | Mantenimiento, centralizado |

### 3.2 Esquema del Subgraph (The Graph)

```graphql
type User @entity {
  id: Bytes! # wallet address
  level: Int!
  referrer: User
  referralCode: Bytes!
  blocks: [Block!]! @derivedFrom(field: "owner")
  memberships: [BlockMember!]! @derivedFrom(field: "member")
  invitedUsers: [User!]! @derivedFrom(field: "referrer")
  registeredAt: BigInt!
}

type Block @entity {
  id: Bytes! # contract address
  owner: User!
  levelId: Int!
  status: Int! # 0=Active, 1=Completed
  members: [BlockMember!]! @derivedFrom(field: "block")
  invitedCount: Int!
  createdAt: BigInt!
  completedAt: BigInt
}

type BlockMember @entity {
  id: ID! # block_address + member_address
  block: Block!
  member: User!
  position: Int!
  joinedAt: BigInt!
}

type Transaction @entity {
  id: Bytes! # tx hash
  user: User!
  type: String! # "registration", "join", "advance", "withdraw"
  amount: BigInt!
  block: Block
  timestamp: BigInt!
}
```

### 3.3 Event Handlers

```typescript
// Evento UserRegistered
export function handleUserRegistered(event: UserRegistered): void {
  let user = new User(event.params.user);
  user.level = event.params.level.toI32();
  user.referrer = event.params.referrer;
  user.registeredAt = event.block.timestamp;
  user.save();
}

// Evento MyBlockCreated
export function handleMyBlockCreated(event: MyBlockCreated): void {
  let block = new Block(event.params.blockAddress);
  block.owner = event.params.center;
  block.levelId = event.params.level.toI32();
  block.status = 0;
  block.createdAt = event.block.timestamp;
  block.save();
}

// Evento MemberJoined
export function handleMemberJoined(event: MemberJoined): void {
  let memberId = event.address.toHexString() + "-" + event.params.member.toHexString();
  let member = new BlockMember(memberId);
  member.block = event.address;
  member.member = event.params.member;
  member.position = event.params.position.toI32();
  member.joinedAt = event.block.timestamp;
  member.save();
}
```

---

## Fase 4: Migración del Frontend

### 4.1 Crear Hook useOnChainData

```typescript
// src/hooks/useOnChainData.tsx
export const useOnChainData = () => {
  const publicClient = usePublicClient();
  
  // Leer nivel de usuario
  const getUserLevel = async (address: string): Promise<number> => {
    const level = await publicClient.readContract({
      address: CONTRACTS.REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'userLevel',
      args: [address],
    });
    return Number(level);
  };
  
  // Leer todos los bloques del usuario
  const getUserBlocks = async (address: string): Promise<BlockData[]> => {
    const blocks: BlockData[] = [];
    for (let level = 1; level <= 7; level++) {
      const blockAddr = await publicClient.readContract({
        address: CONTRACTS.REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'myBlockAtLevel',
        args: [address, level],
      });
      if (blockAddr !== ZERO_ADDRESS) {
        const info = await getBlockInfo(blockAddr);
        blocks.push(info);
      }
    }
    return blocks;
  };
  
  // Resolver código de referido
  const resolveReferralCode = async (code: string): Promise<string | null> => {
    const codeBytes = ethers.utils.formatBytes32String(code);
    const wallet = await publicClient.readContract({
      address: CONTRACTS.REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'resolveReferralCode',
      args: [codeBytes],
    });
    return wallet !== ZERO_ADDRESS ? wallet : null;
  };
  
  return { getUserLevel, getUserBlocks, resolveReferralCode, ... };
};
```

### 4.2 Crear Hook useSubgraphQuery (para datos indexados)

```typescript
// src/hooks/useSubgraphQuery.tsx
const SUBGRAPH_URL = "https://api.thegraph.com/subgraphs/name/cundinablock/v1";

export const useSubgraphQuery = () => {
  const fetchRanking = async (levelId: number) => {
    const query = `
      query GetRanking($level: Int!) {
        blocks(
          where: { levelId: $level, status: 0 }
          orderBy: invitedCount
          orderDirection: desc
          first: 100
        ) {
          id
          owner { id }
          invitedCount
          members { id }
          createdAt
        }
      }
    `;
    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      body: JSON.stringify({ query, variables: { level: levelId } }),
    });
    return response.json();
  };
  
  return { fetchRanking, ... };
};
```

### 4.3 Componentes a Modificar

| Componente | Cambio Requerido |
|------------|------------------|
| `Dashboard.tsx` | Reemplazar `supabase.from('blocks')` → `useOnChainData().getUserBlocks()` |
| `MyBlocks.tsx` | Reemplazar queries Supabase → lecturas on-chain + subgraph |
| `Ranking.tsx` | Reemplazar `supabase.from('blocks')` → `useSubgraphQuery().fetchRanking()` |
| `JoinBlockCard.tsx` | Mantener lógica on-chain, eliminar syncs a DB |
| `PaymentCard.tsx` | Mantener lógica on-chain, eliminar inserts a DB |
| `BlockDetail.tsx` | Leer info del contrato directamente |
| `Profile.tsx` | Código de referido desde contrato |

---

## Fase 5: Edge Functions a Eliminar

Todas estas funciones se vuelven innecesarias:

| Función | Razón de Eliminación |
|---------|---------------------|
| `blockchain-sync` | Datos vienen del subgraph |
| `sync-block-members` | Miembros leídos del contrato |
| `sync-block-status` | Status leído del contrato |
| `sync-wallet-blocks` | Bloques leídos del contrato |
| `resolve-referrer` | Función view del contrato |
| `assign-block` | Lógica movida al contrato |
| `advance-level` | Ya es 100% on-chain |
| `repair-block-members` | No hay DB que reparar |

**Mantener (con modificaciones):**
- `wallet-auth`: Autenticación Supabase (para perfiles)
- `delete-auth-users`: Limpieza de cuentas

---

## Fase 6: Datos que Permanecen en Supabase

### 6.1 Análisis de Tablas - Estado Post-Migración ✅ COMPLETADO

#### Tablas ESENCIALES (mantener sin cambios)

| Tabla | Propósito | Razón |
|-------|-----------|-------|
| `profiles` | Metadata de usuario | Nombres, emails, teléfonos - privacidad, no puede ser on-chain |
| `notifications` | UX/Mensajería | Mensajes push, lectura/no leída - experiencia de usuario |
| `user_roles` | Autorización | Roles admin/user para control de acceso |
| `platform_config` | Configuración | Wallet addresses, parámetros del sistema |
| `levels` | Configuración | Parámetros de niveles (contribution, members, etc.) - referencia estática |
| `platform_wallets` | Configuración | Wallets de plataforma para rotación de comisiones |
| `admin_section_permissions` | Autorización | Permisos granulares de admin UI |

#### Tablas de AUDITORÍA (mantener para historial)

| Tabla | Propósito | Columnas Simplificables |
|-------|-----------|------------------------|
| `transactions` | Auditoría de pagos | ✅ Eliminar: `block_id`, `wallet_id` (usar `contract_address`, `wallet_address`) |
| `ranking_positions` | Historial de ranking | ✅ Eliminar: `block_id` (usar `contract_address`) |

#### Tablas de ESTADO UI (simplificar)

| Tabla | Propósito Actual | Acción Recomendada |
|-------|------------------|-------------------|
| `user_level_progress` | Estado de progreso por nivel | ✅ Simplificar: eliminar `block_id`, `wallet_id` - usar `contract_address`, `wallet_address` |
| `user_wallets` | Mapeo wallet → usuario | ✅ Simplificar: `referred_by_wallet_id` → on-chain lookup |
| `blocks` | Registro de bloques | ⚠️ Evaluar: datos vienen de on-chain, pero útil para navegación rápida |
| `block_members` | Membresías | ⚠️ Evaluar: datos vienen de on-chain, pero útil para queries sin RPC |

### 6.2 Columnas Redundantes a Eliminar (Futuro)

Una vez validada la migración on-chain, estas columnas pueden eliminarse:

```sql
-- Fase de limpieza (ejecutar DESPUÉS de validación completa)
-- ALTER TABLE transactions DROP COLUMN block_id, DROP COLUMN wallet_id;
-- ALTER TABLE ranking_positions DROP COLUMN block_id;
-- ALTER TABLE user_level_progress DROP COLUMN block_id, DROP COLUMN wallet_id;
-- ALTER TABLE block_members DROP COLUMN block_id, DROP COLUMN wallet_id;
-- ALTER TABLE blocks DROP COLUMN wallet_id;
```

**Nota**: Mantener columnas UUID temporalmente como fallback mientras se valida el flujo on-chain.

### 6.3 Tablas que Pueden Volverse Opcionales

| Tabla | Alternativa On-Chain | Recomendación |
|-------|---------------------|---------------|
| `blocks` | `myBlockAtLevel(address, level)` + Subgraph | Mantener como caché para navegación rápida |
| `block_members` | `getMembers()` del contrato + Subgraph | Evaluar eliminar si queries on-chain son suficientes |

### 6.4 Decisión Final de Arquitectura

**Datos SIEMPRE en Supabase:**
- ✅ Perfiles de usuario (privacidad)
- ✅ Notificaciones (UX)
- ✅ Roles y permisos (seguridad)
- ✅ Configuración de plataforma

**Datos PRIMARIOS on-chain, CACHÉ en Supabase:**
- 🔄 Bloques: on-chain es fuente de verdad, DB para navegación
- 🔄 Membresías: on-chain es fuente de verdad, DB para queries rápidas
- 🔄 Progreso de nivel: on-chain determina, DB para UI state

**Datos SOLO en Supabase (auditoría):**
- 📊 Transacciones históricas
- 📊 Posiciones de ranking históricas

---

## Fase 7: Plan de Implementación

### Sprint 1: Smart Contracts (2 semanas) ✅ COMPLETADO

1. Modificar `BlockRegistryFactory` con nuevos mappings
2. Agregar funciones de códigos de referido
3. Agregar función `getAllUserBlocks`
4. Emitir eventos adicionales para indexación
5. Compilar y desplegar en Sepolia testnet
6. Testing exhaustivo con Hardhat

**Contratos V5 desplegados en Sepolia (actuales en src/config/contracts.ts):**
- Registry: `0xe31942A9fF10872fDCbB18c7D23e64673BEe42Ee`
- PayoutModule: `0xe70C02799dd33f9B691E99c2F58102E762673EDD`
- Implementation: `0x8D4B9025FDE454A49Bf97067119290910A9C668D`
- Treasury Safe: `0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a`
- Test USDT: `0xF389b2Ad9524038ef73E23B754aeB0E6D5bcc96E`

**Funciones on-chain disponibles:**
- `resolveReferralCode(bytes32)` → address
- `getReferralCode(address)` → bytes32
- `getReferrer(address)` → address
- `getAllUserBlocks(address)` → address[]
- `getInvitedCount(address)` → uint256
- `myBlockAtLevel(address, uint)` → address
- `userLevel(address)` → uint256

### Sprint 2: Indexador (1 semana) ✅ COMPLETADO

1. Configurar proyecto The Graph
2. Definir schema.graphql
3. Implementar mappings TypeScript
4. Deploy subgraph a Hosted Service
5. Validar queries contra datos de prueba

**Subgraph desplegado:**
- URL: `https://api.studio.thegraph.com/query/1740282/cundinablock-v-1/v0.0.1`
- startBlock: 8200000

### Sprint 3: Frontend - Lectura (2 semanas) ✅ COMPLETADO

1. ✅ Crear `useOnChainData` hook (`src/hooks/useOnChainData.tsx`)
2. ✅ Crear `useSubgraphQuery` hook (`src/hooks/useSubgraphQuery.tsx`)
3. ✅ Migrar `Dashboard.tsx` (usa `useOnChainData.getUserBlocks`)
4. ✅ Migrar `MyBlocks.tsx` (usa `useOnChainData.getUserBlocks`)
5. ✅ Migrar `Ranking.tsx` (usa `useSubgraphQuery.fetchRanking`)
6. ✅ Migrar `BlockDetail.tsx` (ya usa lecturas on-chain directas)
7. ✅ Migrar `Profile.tsx` (referral code desde on-chain con fallback)

**Infraestructura creada:**
- `src/lib/contractReads.ts` - Funciones de lectura de contratos
- `src/lib/subgraph.ts` - Cliente GraphQL para subgraph
- `src/config/subgraph.ts` - Configuración del subgraph

### Sprint 4: Frontend - Escritura (1 semana) ✅ COMPLETADO

1. ✅ Actualizar `PaymentCard.tsx` para eliminar syncs DB (blockchain-sync removido)
2. ✅ Actualizar `JoinBlockCard.tsx` para eliminar syncs DB (block_members insert removido)
3. ✅ Actualizar `BlockCompletionModal.tsx` (block_members insert y increment_invited_members removidos)
4. ✅ Pruebas E2E del flujo completo (usar `test-e2e-flow` Edge Function)

**Estado actual:**
- Los componentes ya usan transacciones on-chain como fuente de verdad
- Syncs redundantes **eliminados**:
  - `blockchain-sync` call en PaymentCard
  - `sync-block-members` call y fallback `block_members` insert en JoinBlockCard
  - `increment_invited_members` RPC (reemplazado por evento on-chain `InviteCountUpdated`)
  - `block_members` insert y `increment_invited_members` en BlockCompletionModal (advance flow)
- Syncs **preservados** para auditoría/UX:
  - `transactions` table: auditoría histórica
  - `notifications`: UX/mensajes push
  - `profiles`: metadata de usuario (nombres, contacto)
  - `blocks` table: registro de contract_address para navegación
  - `user_level_progress`: estado de UI del usuario
  - `advance-level` Edge Function: crea nuevo bloque en DB y actualiza progreso
  - `withdraw-earnings` Edge Function: registra solicitud de retiro

### Sprint 4.3: Componentes Migrados ✅ COMPLETADO

| Componente | Estado | Fuente de Datos |
|------------|--------|-----------------|
| `Dashboard.tsx` | ✅ | `useOnChainData.getUserBlocks()` + subgraph para membresías |
| `MyBlocks.tsx` | ✅ | `useOnChainData.getUserBlocks()` con fallback Supabase |
| `Ranking.tsx` | ✅ | `useSubgraphQuery.fetchRanking()` con fallback Supabase |
| `JoinBlockCard.tsx` | ✅ | Transacciones on-chain via wagmi, solo auditoría a DB |
| `PaymentCard.tsx` | ✅ | Transacciones on-chain via wagmi, solo auditoría a DB |
| `BlockDetail.tsx` | ✅ | Lecturas on-chain directas via `useReadContract` |
| `Profile.tsx` | ✅ | `useOnChainData.getReferralCode()` con fallback DB |

**Estrategia de fallback:**
- Todos los componentes intentan on-chain/subgraph primero
- Si falla, caen a Supabase para mantener funcionalidad
- Datos de auditoría (transactions, notifications) siguen en Supabase

### Sprint 5: Limpieza y Migración (1 semana) ✅ COMPLETADO

1. ✅ Eliminar Edge Functions obsoletas
2. Tablas Supabase conservadas para auditoría
3. Migración de datos históricos (opcional, para analytics)
4. Documentación actualizada

**Edge Functions eliminadas:**
- ✅ `blockchain-sync` - eliminada (datos indexados por Subgraph)
- ✅ `sync-block-members` - eliminada (membresía on-chain)
- ✅ `sync-block-status` - eliminada (status on-chain)
- ✅ `sync-wallet-blocks` - eliminada (bloques on-chain)
- ✅ `resolve-referrer` - eliminada (usar `resolveReferralCode` on-chain)
- ✅ `assign-block` - eliminada (lógica en contrato)
- ✅ `repair-block-members` - eliminada (no hay DB que reparar)

**Edge Functions a mantener:**
- `wallet-auth`: autenticación Supabase
- `delete-auth-users`: limpieza de cuentas
- `advance-level`: registro de avances (puede reducirse)
- `withdraw-earnings`: registro de retiros
- `deploy-contracts`: despliegue de contratos (admin)
- `test-e2e-flow`: testing automatizado
- `block-members-public`: bridge de privacidad para miembros
- `update-ranking-positions`: actualiza posiciones de ranking (cron)

### Sprint 6: Correcciones Finales ✅ COMPLETADO

1. ✅ Corregir indentación en `subgraph/subgraph.yaml` (YAML parsing)
2. ✅ Verificar address del Registry V5 en subgraph

### Sprint 7: Eliminación de Mapeos UUID ✅ COMPLETADO

**Objetivo**: Usar direcciones de contrato (0x...) y wallet (0x...) directamente en lugar de UUIDs internos.

**Schema Changes**:
1. ✅ Agregar columnas `contract_address` y `wallet_address` a:
   - `ranking_positions`
   - `transactions`
   - `user_level_progress`
   - `block_members`
2. ✅ Crear índices para búsquedas eficientes
3. ✅ Migrar datos existentes
4. ✅ Crear índice único `ranking_positions_level_contract_unique`

**Edge Functions Actualizadas**:
1. ✅ `advance-level`: Usa `walletAddress` y `currentBlockAddress` en lugar de UUIDs
2. ✅ `block-members-public`: Lee miembros directamente del contrato on-chain
3. ✅ `update-ranking-positions`: Usa `contract_address` como identificador
4. ✅ `withdraw-earnings`: Usa `walletAddress` y `contractAddress`

**Tablas que se pueden eliminar en futuro**:
- `blocks` - Datos vienen del subgraph
- `block_members` - Datos vienen del subgraph
- `user_wallets` - Referral codes están on-chain en V4

---

## Fase 8: Consideraciones de Costos

### Costos de Gas Adicionales

| Operación | Costo Actual | Costo Nuevo | Delta |
|-----------|-------------|-------------|-------|
| Registro | ~$0.50 | ~$0.70 | +$0.20 (almacenar referral code) |
| Join Block | ~$0.30 | ~$0.35 | +$0.05 (emit más eventos) |
| Advance | ~$0.80 | ~$0.80 | Sin cambio |

### Costos de Infraestructura

| Servicio | Costo Mensual Estimado |
|----------|----------------------|
| The Graph (Hosted) | $0 (gratis hasta límites) |
| The Graph (Decentralized) | ~$50-200/mes según queries |
| Alchemy RPC | $0-49/mes según tier |
| Supabase (reducido) | ~$25/mes (solo auth + profiles) |

---

## Fase 9: Beneficios de la Migración

1. **Descentralización**: Datos críticos inmutables y auditables
2. **Eliminación de Single Point of Failure**: No dependencia de Supabase para operaciones core
3. **Transparencia**: Cualquiera puede verificar estado de bloques y referidos
4. **Reducción de Complejidad**: Menos código de sincronización
5. **Menor Superficie de Ataque**: Menos endpoints de API expuestos

---

## Fase 10: Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Latencia de subgraph | UX degradada | Cache local + optimistic updates |
| Costos de gas altos | Menor adopción | Considerar L2 (Arbitrum, Base) |
| Pérdida de datos históricos | Analytics limitados | Exportar antes de eliminar |
| Complejidad de migración | Bugs en producción | Testing exhaustivo + rollback plan |

---

## Sección Técnica Detallada

### Solidity: Cambios Específicos al Registry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract BlockRegistryFactory is Ownable2Step, ReentrancyGuard {
    // ... código existente ...
    
    // NUEVOS MAPPINGS
    mapping(bytes32 => address) public referralCodeToWallet;
    mapping(address => bytes32) public walletToReferralCode;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public invitedCountByBlock;
    
    // NUEVOS EVENTOS
    event ReferralCodeGenerated(address indexed wallet, bytes32 indexed code);
    event ReferralChainCreated(address indexed user, address indexed referrer);
    
    // NUEVAS FUNCIONES
    function resolveReferralCode(bytes32 code) external view returns (address) {
        return referralCodeToWallet[code];
    }
    
    function getReferralCode(address wallet) external view returns (bytes32) {
        return walletToReferralCode[wallet];
    }
    
    function getReferrer(address wallet) external view returns (address) {
        return referrerOf[wallet];
    }
    
    function getAllUserBlocks(address user) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= 7; i++) {
            if (myBlockAtLevel[user][i] != address(0)) count++;
        }
        
        address[] memory blocks = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i <= 7; i++) {
            if (myBlockAtLevel[user][i] != address(0)) {
                blocks[idx++] = myBlockAtLevel[user][i];
            }
        }
        return blocks;
    }
    
    function getInvitedCount(address blockAddr) external view returns (uint256) {
        return invitedCountByBlock[blockAddr];
    }
}
```

### Frontend: Estructura de Archivos Nueva

```text
src/
├── hooks/
│   ├── useOnChainData.tsx      # NUEVO: Lecturas directas del contrato
│   ├── useSubgraphQuery.tsx    # NUEVO: Queries al subgraph
│   ├── useWeb3.tsx             # MANTENER: Conexión wallet (legacy)
│   └── useWagmiWeb3.tsx        # MANTENER: Conexión Reown
├── lib/
│   ├── subgraph.ts             # NUEVO: Cliente GraphQL
│   └── contractReads.ts        # NUEVO: Helpers de lectura
├── pages/
│   ├── Dashboard.tsx           # MODIFICAR: Usar hooks on-chain
│   ├── MyBlocks.tsx            # MODIFICAR: Usar hooks on-chain
│   └── Ranking.tsx             # MODIFICAR: Usar subgraph
└── config/
    ├── contracts.ts            # MANTENER: Direcciones
    └── subgraph.ts             # NUEVO: URL del subgraph
```

 ---
 
 ## Estado de Implementación (Actualizado: Feb 2026)
 
### ✅ MIGRACIÓN COMPLETADA (Feb 2026)
 
La arquitectura 100% on-chain está completamente implementada:
 
 | Archivo | Propósito |
 |---------|-----------|
 | `src/config/subgraph.ts` | Configuración y tipos del subgraph |
 | `src/lib/subgraph.ts` | Cliente GraphQL y queries pre-construidos |
 | `src/lib/contractReads.ts` | Helpers para lectura de contratos |
 | `src/hooks/useOnChainData.tsx` | Hook para lecturas directas del contrato |
 | `src/hooks/useSubgraphQuery.tsx` | Hook para queries al subgraph |
 | `subgraph/schema.graphql` | Esquema del subgraph |
 | `subgraph/subgraph.yaml` | Manifiesto del subgraph |
 | `subgraph/src/registry.ts` | Handlers de eventos del Registry |
 | `subgraph/src/block.ts` | Handlers de eventos de bloques |
 
### Componentes Migrados
 
| Componente | Fuente de Datos | Estado |
|------------|-----------------|--------|
| `Dashboard.tsx` | `useOnChainData` + Subgraph | ✅ |
| `MyBlocks.tsx` | `useOnChainData` | ✅ |
| `Ranking.tsx` | `useSubgraphQuery` | ✅ |
| `BlockDetail.tsx` | `useReadContract` | ✅ |
| `Profile.tsx` | On-chain + fallback DB | ✅ |
| `PaymentCard.tsx` | Wagmi write + auditoría DB | ✅ |
| `JoinBlockCard.tsx` | Wagmi write + auditoría DB | ✅ |
 
### Edge Functions Activas
 
| Función | Propósito |
|---------|-----------|
| `wallet-auth` | Autenticación con firma de wallet |
| `delete-auth-users` | Limpieza de cuentas |
| `advance-level` | Registro de avances en DB |
| `withdraw-earnings` | Registro de retiros |
| `block-members-public` | Lectura on-chain de miembros |
| `update-ranking-positions` | Cron de ranking |
| `deploy-contracts` | Admin: despliegue |
| `test-e2e-flow` | Testing automatizado |
 
### Contratos Activos (Sepolia)
 
| Contrato | Dirección |
|----------|-----------|
| Registry | `0xe31942A9fF10872fDCbB18c7D23e64673BEe42Ee` |
| PayoutModule | `0xe70C02799dd33f9B691E99c2F58102E762673EDD` |
| Implementation | `0x8D4B9025FDE454A49Bf97067119290910A9C668D` |
| Treasury Safe | `0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a` |
| Test USDT | `0xF389b2Ad9524038ef73E23B754aeB0E6D5bcc96E` |
 
### Subgraph
 
- URL: `https://api.studio.thegraph.com/query/1740282/cundinablock-v-1/v0.0.1`
- Network: Sepolia
- startBlock: 8200000
 
 ---
 
 ## Próximos Pasos Inmediatos
 
 1. ✅ **Todo completado** - La arquitectura on-chain está lista
 2. 🔄 **Opcional**: Eliminar columnas UUID redundantes una vez validado el flujo
 3. 🔄 **Opcional**: Evaluar si tablas `blocks` y `block_members` pueden eliminarse
 4. 🔄 **Mantenimiento**: Actualizar documentación técnica
