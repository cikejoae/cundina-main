# 🚀 Guía de Deployment - Cundina Block Factory

## Requisitos Previos

1. **Node.js y npm** instalados
2. **MetaMask** configurada con Sepolia testnet
3. **Sepolia ETH** para gas (obtén en https://sepoliafaucet.com/)
4. **Tokens CUNDINA** en tu wallet de deployment

## Paso 1: Configurar Variables de Entorno

### 1.1 Obtener RPC URL de Sepolia

Opciones gratuitas:
- **Infura**: https://infura.io/ → Crea proyecto → Copia Sepolia endpoint
- **Alchemy**: https://alchemy.com/ → Crea app → Copia Sepolia URL
- **Público**: `https://rpc.sepolia.org` (menos confiable)

### 1.2 Obtener Private Key

⚠️ **NUNCA uses una wallet con fondos reales en mainnet**

En MetaMask:
1. Click en los 3 puntos → Detalles de la cuenta
2. Exportar clave privada
3. Copia la clave (SIN el prefijo 0x)

### 1.3 Configurar archivos `.env`

**En la carpeta `contracts/`**, crea `.env`:

```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/TU_INFURA_KEY
PRIVATE_KEY=tu_private_key_sin_0x
PLATFORM_WALLET_ADDRESS=0xTuDireccionParaRecibirFees
```

**En la raíz del proyecto**, verifica que `.env` tenga:

```bash
VITE_BLOCK_FACTORY_ADDRESS=  # Lo llenarás después del deploy
```

## Paso 2: Instalar Dependencias y Compilar

```bash
cd contracts
npm install
npx hardhat compile
```

✅ Deberías ver: "Compiled X Solidity files successfully"

## Paso 3: Configurar Wallet de la Plataforma

Edita `contracts/scripts/deploy.js` línea 11:

```javascript
const PLATFORM_WALLET = "0xTU_DIRECCION_AQUI"; // ⚠️ Cámbiala!
```

Esta wallet recibirá los 20 CUNDINA de cada registro.

## Paso 4: Deployar el Contrato

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

**Resultado esperado:**

```
Deploying BlockFactory...
BlockFactory deployed to: 0xABC123...

=== DEPLOYMENT INFO ===
Network: Sepolia
CUNDINA Token: 0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7
BlockFactory: 0xABC123...
Platform Wallet: 0xYourWallet...

Update these addresses in your .env file:
VITE_BLOCK_FACTORY_ADDRESS=0xABC123...
```

🎉 **Copia la dirección del BlockFactory**

## Paso 5: Actualizar Variables de Entorno del Proyecto

### 5.1 Actualizar .env local

En la raíz del proyecto, edita `.env`:

```bash
VITE_BLOCK_FACTORY_ADDRESS=0xABC123DeployedAddress
```

### 5.2 Actualizar secrets de Lovable Cloud

Los siguientes secrets ya están configurados:
- ✅ SEPOLIA_RPC_URL
- ✅ DEPLOYER_PRIVATE_KEY  
- ✅ PLATFORM_WALLET_ADDRESS

**Necesitas agregar el nuevo:**

Ve a la configuración de Lovable Cloud y agrega:

```
VITE_BLOCK_FACTORY_ADDRESS=0xABC123DeployedAddress
```

## Paso 6: Verificar el Deployment (Opcional)

### 6.1 En Etherscan Sepolia

Visita: `https://sepolia.etherscan.io/address/0xTU_FACTORY_ADDRESS`

Deberías ver:
- ✅ Código del contrato deployado
- ✅ Transacciones de creación

### 6.2 Verificar el código (Opcional)

```bash
npx hardhat verify --network sepolia 0xTU_FACTORY_ADDRESS "0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7" "0xTU_PLATFORM_WALLET"
```

Esto hace el contrato público y verificable en Etherscan.

## Paso 7: Probar el Sistema

### 7.1 Obtener CUNDINA Tokens

Necesitas tokens CUNDINA de prueba en Sepolia. Contacta al administrador del token o usa el faucet si está disponible.

### 7.2 Probar el registro

1. Conecta tu wallet a la app
2. Asegúrate de tener:
   - Sepolia ETH para gas (mínimo 0.01 ETH)
   - 20+ CUNDINA tokens
3. Completa el formulario de registro
4. Confirma la transacción en MetaMask

### 7.3 Verificar el resultado

Deberías ver:
- ✅ Transacción confirmada en MetaMask
- ✅ Balance reducido en 20 CUNDINA
- ✅ Perfil creado en el dashboard
- ✅ Asignado automáticamente a un bloque

## Solución de Problemas

### Error: "insufficient funds for gas"
- Necesitas más Sepolia ETH
- Obtén en: https://sepoliafaucet.com/

### Error: "execution reverted"
- Verifica que tengas suficientes CUNDINA tokens
- Verifica que estés en la red Sepolia
- Revisa que el BLOCK_FACTORY_ADDRESS esté correcto

### Error: "nonce too high"
- Reset MetaMask: Settings → Advanced → Reset Account

### Los tokens no se descuentan
- Verifica el allowance: puede que necesites aprobar primero
- El sistema hace approve automático, espera a que ambas transacciones se confirmen

## Estructura de Niveles Configurada

1. **Nivel 1 - Curioso**: 9 miembros × 20 CUNDINA = 180 CUNDINA
2. **Nivel 2 - Aprendiz**: 9 miembros × 45 CUNDINA = 405 CUNDINA
3. **Nivel 3 - Experimentado**: 9 miembros × 90 CUNDINA = 810 CUNDINA
4. **Nivel 4 - Profesional**: 9 miembros × 180 CUNDINA = 1,620 CUNDINA
5. **Nivel 5 - Experto**: 9 miembros × 360 CUNDINA = 3,240 CUNDINA
6. **Nivel 6 - Maestro**: 9 miembros × 720 CUNDINA = 6,480 CUNDINA
7. **Nivel 7 - Leyenda**: 9 miembros × 750 CUNDINA = 6,750 CUNDINA

## Próximos Pasos

Después del deployment exitoso:

1. ✅ Actualizar `.env` con VITE_BLOCK_FACTORY_ADDRESS
2. ✅ Probar el registro de usuarios
3. ✅ Verificar que los bloques se crean correctamente
4. ✅ Monitorear las transacciones en Etherscan
5. ✅ Documentar la dirección del contrato para el equipo

## Comandos Útiles

```bash
# Compilar contratos
npm run compile

# Limpiar artifacts
npx hardhat clean

# Ver cuentas de Hardhat
npx hardhat accounts

# Ejecutar tests (si existen)
npm run test
```

## Contacto y Soporte

Si encuentras problemas durante el deployment, verifica:
1. Que todas las variables de entorno estén correctas
2. Que tengas fondos suficientes (ETH + CUNDINA)
3. Que estés en la red Sepolia
4. Los logs de error en la consola

---

**⚠️ IMPORTANTE**: Guarda toda la información de deployment en un lugar seguro:
- Dirección del BlockFactory deployado
- Transaction hash del deployment
- Private key de la wallet de deployment (en lugar seguro)
- Platform wallet address

Esta información es crítica para la operación de la plataforma.
