# GUÍA DE DESPLIEGUE V2 - Arquitectura Safe Treasury

## Arquitectura

Esta versión usa 3 contratos principales:

1. **CundinaBlockSecure** - Template clonable (IMPLEMENTATION)
2. **BlockRegistryFactory** - Factory/Registry principal
3. **SafeTreasuryPayoutModule** - Módulo para pagos desde Safe Treasury

## PRECONDICIONES

Antes de empezar, asegúrate de tener:

- ✅ Address del token ERC20 (18 decimales): `0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7`
- ✅ Address de la Safe del proyecto (treasurySafe)
- ✅ Address de platformWallet
- ✅ Acceso a Remix IDE
- ✅ Safe treasury creada en app.safe.global
- ✅ MetaMask conectado a Sepolia

---

## PASO 1 — Compilar en Remix

1. Abrir [Remix IDE](https://remix.ethereum.org)
2. Crear/pegar el archivo `CundinaBlockSecure.sol`
3. Configurar Solidity Compiler:
   - **Compiler**: `0.8.28`
   - **Optimization**: `ON`
   - **Runs**: `200`
4. Click **Compile**

> ⚠️ Si Remix da error "stack too deep", activar `viaIR = true` y recompilar.

---

## PASO 2 — Deploy IMPLEMENTATION (CundinaBlockSecure)

> Este contrato es solo un template, NO interactuar después.

1. En "Deploy & Run Transactions"
2. Seleccionar: `CundinaBlockSecure`
3. Click **Deploy**
4. Guardar la address como: `BLOCK_IMPLEMENTATION`

⚠️ **NO** interactuar con este contrato después del deploy.

---

## PASO 3 — Deploy REGISTRY (BlockRegistryFactory)

1. Seleccionar: `BlockRegistryFactory`
2. Llenar constructor en este orden:
   ```
   _token              → 0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7
   _treasurySafe       → Address de tu Safe
   _platformWallet     → Address de platformWallet
   _blockImplementation→ BLOCK_IMPLEMENTATION (del paso 2)
   ```
3. Click **Deploy**
4. Guardar la address como: `REGISTRY`

### Verificaciones inmediatas en REGISTRY:
- `treasurySafe()` → Safe correcta
- `registrationFee()` → `20000000000000000000`
- `levelCfg(1)` → `(9, 20e18, true)`

---

## PASO 4 — Deploy PAYOUT MODULE (SafeTreasuryPayoutModule)

1. Seleccionar: `SafeTreasuryPayoutModule`
2. Llenar constructor:
   ```
   _token          → 0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7
   _treasurySafe   → Address de tu Safe
   _platformWallet → Address de platformWallet
   _registry       → REGISTRY (del paso 3)
   ```
3. Click **Deploy**
4. Guardar la address como: `MODULE`

### Verificaciones en MODULE:
- `treasurySafe()` → Safe correcta
- `registry()` → REGISTRY

---

## PASO 5 — Conectar REGISTRY con MODULE

En el contrato **REGISTRY**, ejecutar:

```solidity
setPayoutModule(MODULE)
```

Verificar: `payoutModule()` → devuelve MODULE

---

## PASO 6 — Habilitar MODULE en Safe Treasury (OBLIGATORIO)

Esto se hace en [app.safe.global](https://app.safe.global):

1. Abrir app.safe.global
2. Seleccionar tu Safe treasury
3. Ir a **Settings → Modules**
4. Click **Add custom module**
5. Pegar la address del **MODULE**
6. Confirmar la transacción

> ⚠️ **CRÍTICO**: Si este paso no se hace, `cashout` y `advance` SIEMPRE fallarán.

---

## PASO 7 — Verificación Final

Antes de probar usuarios, confirmar:

### En REGISTRY:
- `treasurySafe()` → Safe correcta ✅
- `platformWallet()` → correcta ✅
- `payoutModule()` → MODULE ✅

### En MODULE:
- `treasurySafe()` → Safe correcta ✅
- `registry()` → REGISTRY ✅

**Si todo coincide → Deploy correcto ✅**

---

## FLUJO DE USUARIOS

### 1. Registro (20 USDT → treasury)

```solidity
// Desde wallet del usuario (EOA)
// 1. Aprobar tokens
token.approve(REGISTRY, 20e18)

// 2. Registrar
registry.registerUser(userEOA, referrerEOA)
// referrerEOA = 0x000...0 si no hay referido
```

**Verificar:** `userLevel(userEOA)` → 1

### 2. Crear Bloque Nivel 1

```solidity
registry.createMyBlock(userEOA)
```

**Verificar:** `myBlockAtLevel(userEOA, 1)` → address del bloque

### 3. Agregar Miembros al Bloque

Para cada miembro:

```solidity
// 3.1 Registrar miembro
token.approve(REGISTRY, 20e18)
registry.registerUser(memberEOA, userEOA)

// 3.2 Aprobar aporte al bloque
token.approve(blockL1, 20e18)

// 3.3 Unir al bloque
registry.joinLevel1(blockL1, memberEOA)
```

**Verificar:** Cuando `membersCount()` → 9, `status()` → Completed

### 4. Cashout o Advance (desde Safe Treasury)

#### 4.1 Cashout (retira y regresa a nivel 1)

Desde app.safe.global → Safe treasury → Transaction al MODULE:

```solidity
cashout(blockL1, centerEOA, payoutToEOA)
```

**Efecto:**
- 10% fee → platformWallet
- payout → payoutToEOA
- `userLevel(centerEOA)` → 1
- `blockSettled(blockL1)` → true

#### 4.2 Advance (sube al siguiente nivel)

```solidity
advance(blockL1, centerEOA, payoutToEOA)
```

**Efecto:**
- 10% fee → platformWallet
- costNext (50e18 para N2) → platformWallet
- payout restante → payoutToEOA
- `userLevel(centerEOA)` → 2
- Se crea bloque N2 automáticamente

### 5. Slots (Nivel 2+)

#### 5.1 Generar slots invitando gente nueva:
```solidity
registry.registerUser(newUserEOA, centerEOA)
// inviteSlots(blockL2) incrementa
```

#### 5.2 Subir usuario de N1 a N2:
```solidity
// El usuario debe tener su bloque N1 completado
token.approve(blockL2, 50e18)
registry.upgradeAndJoin(u1, blockL2)
```

---

## Errores Típicos

| Error | Causa |
|-------|-------|
| `user=treasury` | Estás usando la Safe como usuario |
| `member=treasury` | El miembro es la Safe treasury |
| `Fee-on-transfer not supported` | Token con impuesto |
| `no slots` | El bloque L2+ no tiene inviteSlots |
| `prev not completed` | El bloque previo no está completado |
| `Only treasury safe` | Cashout/Advance debe ser desde Safe |

---

## Direcciones a Guardar

```env
# Token ERC20 (USDT Test)
TOKEN=0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7

# Addresses después del deploy
BLOCK_IMPLEMENTATION=<del paso 2>
REGISTRY=<del paso 3>
MODULE=<del paso 4>

# Safe Treasury
TREASURY_SAFE=<tu Safe>
PLATFORM_WALLET=<tu platformWallet>
```

## Actualizar Frontend

Después del deploy, actualizar `.env`:

```env
VITE_BLOCK_REGISTRY_ADDRESS=<REGISTRY>
VITE_PAYOUT_MODULE_ADDRESS=<MODULE>
VITE_TREASURY_SAFE_ADDRESS=<TREASURY_SAFE>
```
