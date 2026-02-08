# Guía de Despliegue - Cundina Block v2.0

## ⚠️ IMPORTANTE: Corrección Crítica Aplicada

Esta versión corrige el error crítico donde el creador no contribuía tokens, causando que la distribución de recompensas fallara.

### Contrato Anterior (v1.0) - NO USAR
- **Dirección:** 0xb8De673Ca03E7f690F6408678c2072c5970EA2a9
- **Red:** Sepolia
- **Estado:** ❌ OBSOLETO - Todos los bloques fallarán al completarse
- **Problema:** El creador no contribuye tokens, causando saldo insuficiente

### Cambios en v2.0
✅ El creador debe llamar a `joinBlock()` para contribuir tokens como todos los demás
✅ Los bloques ahora se crean con 0 miembros inicialmente
✅ La distribución automática funciona correctamente

## Pasos de Despliegue

### 1. Preparar Entorno

```bash
cd contracts
npm install
```

### 2. Configurar Variables de Entorno

Crea/actualiza `contracts/.env`:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/TU_INFURA_KEY
PRIVATE_KEY=tu_private_key_aqui
DEPLOYER_PRIVATE_KEY=tu_private_key_aqui
PLATFORM_WALLET_ADDRESS=0x_tu_wallet_address
```

### 3. Compilar Contratos

```bash
npm run compile
```

Esto genera:
- `artifacts/` - Compilados de Hardhat
- `src/contracts/` - ABIs para el frontend

### 4. Desplegar a Sepolia

```bash
npm run deploy
```

El script desplegará:
1. Token CUNDINA (si no existe)
2. BlockFactory con los 7 niveles configurados

**Guarda las direcciones desplegadas:**

```
CUNDINA Token deployed to: 0x...
BlockFactory deployed to: 0x...
```

### 5. Actualizar Variables de Entorno del Proyecto

Edita `.env` en la raíz del proyecto:

```env
VITE_CUNDINA_TOKEN_ADDRESS=0x_token_address
VITE_BLOCK_FACTORY_ADDRESS=0x_factory_address
```

### 6. Verificar Contratos (Opcional)

Para verificar en Etherscan:

```bash
npx hardhat verify --network sepolia 0x_FACTORY_ADDRESS "0x_TOKEN_ADDRESS" "0x_PLATFORM_WALLET"
```

## Testing del Contrato Corregido

### Flujo Completo de Prueba

1. **Registrar Usuario:**
   ```javascript
   await blockFactory.registerUser()
   ```

2. **Crear Bloque:**
   ```javascript
   const tx = await blockFactory.createBlock(1) // Nivel 1
   const receipt = await tx.wait()
   const blockAddress = receipt.events[0].args.blockAddress
   ```

3. **Aprobar Tokens:**
   ```javascript
   await cundinaToken.approve(blockAddress, contributionAmount)
   ```

4. **Creador se une al bloque:**
   ```javascript
   await cundinaBlock.joinBlock() // El creador DEBE hacer esto
   ```

5. **Otros usuarios se unen:**
   ```javascript
   // Repetir pasos 3-4 para 8 usuarios más
   ```

6. **Verificar distribución automática:**
   ```javascript
   const status = await cundinaBlock.status()
   // status debe ser 2 (Distributed)
   ```

## Verificación de Corrección

Para verificar que el contrato funciona correctamente:

```javascript
// 1. Crear bloque
const blockAddress = await createBlock(1)
const block = await CundinaBlock.at(blockAddress)

// 2. Verificar que no hay miembros inicialmente
const members = await block.getMembers()
assert(members.length === 0, "Block should start with 0 members")

// 3. Creador se une
await cundinaToken.approve(blockAddress, amount)
await block.joinBlock()
const membersAfter = await block.getMembers()
assert(membersAfter.length === 1, "Creator should be first member after joining")

// 4. Completar bloque con 8 usuarios más
// ... agregar 8 miembros más

// 5. Verificar distribución exitosa
const status = await block.status()
assert(status === 2, "Block should be distributed")
```

## Migración desde v1.0

### Para Bloques Existentes

❌ Los bloques creados con v1.0 NO PUEDEN ser arreglados
- El problema está en el código del contrato desplegado
- No hay función de upgrade implementada
- Recomendación: Crear nuevos bloques con v2.0

### Para la Plataforma

1. Desplegar nuevos contratos v2.0
2. Actualizar `.env` con nuevas direcciones
3. Agregar aviso en UI sobre bloques antiguos
4. Permitir solo creación de bloques nuevos

## Troubleshooting

### Error: "Insufficient balance" al completar bloque
**Causa:** Usando contrato v1.0 donde el creador no contribuyó
**Solución:** Usar contrato v2.0

### Error: "Already a member"
**Causa:** Usuario intenta unirse dos veces
**Solución:** Verificar `isMember[address]` antes de llamar `joinBlock()`

### Error: "Block is full"
**Causa:** Ya hay 9 miembros en el bloque
**Solución:** Crear un nuevo bloque

## Contacto de Soporte

Para problemas con el despliegue, contactar al equipo de desarrollo.
