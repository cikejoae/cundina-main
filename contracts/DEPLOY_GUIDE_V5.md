# Guía de Despliegue V5 - TOP Block Automático

## Cambios en V5

El `SafeTreasuryPayoutModule` ahora:
1. **Busca automáticamente** el TOP block en el siguiente nivel
2. **Paga directamente** al creador del TOP block (90% del costNext)
3. **Emite eventos** para tracking on-chain
4. **Fallback**: Si no hay TOP block, los fondos quedan en Treasury

### Nuevos Eventos

```solidity
event TopBlockPaymentExecuted(address indexed center, address indexed topBlock, address indexed topBlockCreator, uint256 amount);
event NoTopBlockAvailable(address indexed center, uint256 level, uint256 amountRetainedInTreasury);
```

### Nuevas Funciones en Registry

```solidity
// Buscar TOP block (highest invitedCount con slots disponibles)
function findTopBlockAtLevel(uint256 level) public view returns (address topBlock, address topBlockCreator);

// Ver bloques activos por nivel
function getActiveBlockCountAtLevel(uint256 level) external view returns (uint256);
```

---

## Prerequisitos

- Remix IDE: https://remix.ethereum.org
- MetaMask con Sepolia ETH
- Test USDT (6 decimals): `0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064`
- Treasury Safe: `0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a`
- SocCoop Wallet: `0x87cec37915cce393edefe1f110eac3bb22daec1b`

---

## Pasos de Despliegue

### 1. Compilar en Remix

```
Compiler: 0.8.28
Optimization: ON (200 runs)
viaIR: true
EVM Version: Paris
```

### 2. Desplegar CundinaBlockSecure (Implementation)

1. Seleccionar `CundinaBlockSecure` en el dropdown
2. Deploy (sin argumentos)
3. **Guardar dirección**: `IMPLEMENTATION_ADDRESS`

### 3. Desplegar BlockRegistryFactory

Constructor args:
```
_token: 0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064
_treasurySafe: 0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a
_blockImplementation: [IMPLEMENTATION_ADDRESS del paso 2]
```

**Guardar dirección**: `REGISTRY_ADDRESS`

### 4. Desplegar SafeTreasuryPayoutModule

Constructor args:
```
_token: 0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064
_treasurySafe: 0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a
_socCoopWallet: 0x87cec37915cce393edefe1f110eac3bb22daec1b
_registry: [REGISTRY_ADDRESS del paso 3]
```

**Guardar dirección**: `PAYOUT_MODULE_ADDRESS`

### 5. Configurar Registry

En el Registry desplegado, llamar:
```solidity
setPayoutModule([PAYOUT_MODULE_ADDRESS])
```

### 6. Habilitar PayoutModule en Gnosis Safe

1. Ir a https://app.safe.global
2. Settings → Modules
3. Add Module: `[PAYOUT_MODULE_ADDRESS]`
4. Firmar con owners requeridos

---

## Actualizar Frontend

En `src/config/contracts.ts`:

```typescript
export const CONTRACTS = {
  USDT_TOKEN: "0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064" as const,
  IMPLEMENTATION: "[NUEVA_IMPLEMENTATION_ADDRESS]" as const,
  REGISTRY: "[NUEVA_REGISTRY_ADDRESS]" as const,
  PAYOUT_MODULE: "[NUEVA_PAYOUT_MODULE_ADDRESS]" as const,
  TREASURY: "0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a" as const,
} as const;
```

---

## Flujo de Avance con V5

```
Usuario completa L1 → Llama PayoutModule.advance()
                              │
                              ├── $5 (10%) → SocCoop Wallet ✅
                              │
                              ├── findTopBlockAtLevel(2)
                              │         │
                              │         ├── SI hay TOP: $45 → TOP creator ✅
                              │         │                 emit TopBlockPaymentExecuted
                              │         │
                              │         └── NO hay TOP: $45 queda en Treasury
                              │                         emit NoTopBlockAvailable
                              │
                              ├── $112 → Usuario ✅
                              │
                              └── Crear bloque L2 ✅
```

---

## Verificación Post-Deploy

1. **Verificar findTopBlockAtLevel**: Llamar con nivel 2 y confirmar que retorna address(0) si no hay bloques
2. **Verificar activeBlocksAtLevel**: Crear un bloque y confirmar que aparece en la lista
3. **Probar advance**: Completar L1, llamar advance, verificar eventos

---

## Notas Importantes

- El usuario **no se une automáticamente** al TOP block (limitación de permisos)
- Solo se paga al creador del TOP block
- El usuario debe llamar `joinTargetBlock` manualmente después del advance
- Esto se puede automatizar en el frontend mostrando el TOP block asignado
