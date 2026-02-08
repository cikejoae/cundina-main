# Instrucciones para Desplegar el Factory Contract

## Estado Actual

El sistema está configurado con una dirección temporal en `.env`. Para tener tu propio Factory Contract desplegado, sigue estos pasos:

## Paso 1: Instalar Dependencias

```bash
cd contracts
npm install
```

## Paso 2: Compilar el Contrato

```bash
npx hardhat compile
```

## Paso 3: Configurar el Script de Deploy

Edita `contracts/scripts/deploy.js` y cambia la línea 11:

```javascript
const PLATFORM_WALLET = "TU_DIRECCION_DE_WALLET_AQUI";
```

Usa la dirección de wallet que recibirá las fees de registro (20 CUNDINA por usuario).

## Paso 4: Configurar Variables de Entorno

Crea un archivo `contracts/.env` con:

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/TU_API_KEY
PRIVATE_KEY=tu_private_key_sin_0x
```

**⚠️ IMPORTANTE:** 
- Nunca compartas tu PRIVATE_KEY
- Usa una wallet de prueba con solo Sepolia ETH
- Necesitas Sepolia ETH para gas (consigue gratis en: https://sepoliafaucet.com/)

## Paso 5: Desplegar el Contrato

```bash
cd contracts
npx hardhat run scripts/deploy.js --network sepolia
```

El script mostrará algo como:

```
BlockFactory deployed to: 0x1234567890abcdef...
```

## Paso 6: Actualizar el .env del Proyecto

Copia la dirección del contrato desplegado y actualiza el archivo `.env` en la raíz del proyecto:

```
VITE_BLOCK_FACTORY_ADDRESS=0x1234567890abcdef...
```

## Paso 7: Verificar el Contrato (Opcional)

Para verificar tu contrato en Etherscan Sepolia:

```bash
npx hardhat verify --network sepolia <FACTORY_ADDRESS> "0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7" "<PLATFORM_WALLET>"
```

## Troubleshooting

### Error: "insufficient funds for gas"
- Necesitas Sepolia ETH en tu wallet de despliegue
- Consigue gratis en: https://sepoliafaucet.com/

### Error: "nonce too high"
```bash
npx hardhat clean
# Luego intenta desplegar de nuevo
```

### Error al compilar
```bash
cd contracts
rm -rf cache artifacts
npx hardhat compile
```

## Verificar el Despliegue

Una vez desplegado, puedes ver tu contrato en:
https://sepolia.etherscan.io/address/<TU_FACTORY_ADDRESS>

## Configuración de Niveles

El Factory Contract viene preconfigurado con 7 niveles:

1. **Curioso** - 9 miembros, 20 CUNDINA cada uno, 180 total
2. **Aprendiz** - 9 miembros, 40 CUNDINA cada uno, 360 total
3. **Experimentado** - 9 miembros, 80 CUNDINA cada uno, 720 total
4. **Profesional** - 9 miembros, 160 CUNDINA cada uno, 1,440 total
5. **Experto** - 9 miembros, 320 CUNDINA cada uno, 2,880 total
6. **Maestro** - 9 miembros, 640 CUNDINA cada uno, 5,760 total
7. **Leyenda** - 9 miembros, 1280 CUNDINA cada uno, 11,520 total

## Soporte

Si tienes problemas, verifica:
1. Tienes Sepolia ETH en tu wallet
2. El RPC_URL está correcto
3. La PRIVATE_KEY es válida
4. Estás en la red Sepolia
