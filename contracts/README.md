# Cundina Block Smart Contracts

## ⚠️ ACTUALIZACIÓN CRÍTICA - v2.0

### Corrección de Error Matemático Crítico

**Problema en v1.0 (Contrato: 0xb8De673Ca03E7f690F6408678c2072c5970EA2a9):**
- El creador se agregaba automáticamente como miembro sin contribuir tokens
- Cuando el bloque se completaba, faltaban tokens (ejemplo: solo 160 CUNDINA en lugar de 180)
- La distribución de recompensas fallaba con error "Insufficient balance"
- **TODOS LOS BLOQUES CREADOS CON v1.0 FALLARÁN AL COMPLETARSE**

**Solución en v2.0:**
- ✅ El creador ya NO se agrega automáticamente en el constructor
- ✅ El creador DEBE llamar a `joinBlock()` y contribuir tokens como todos los demás
- ✅ Garantiza que se acumulen todos los tokens correctamente
- ✅ La distribución automática funciona al completarse el bloque

### Flujo Correcto de Uso (v2.0)

1. **Crear Bloque:** Usuario llama a `BlockFactory.createBlock(levelId)`
   - El contrato se crea pero el creador NO es miembro todavía
2. **Aprobar Tokens:** Usuario aprueba tokens al contrato del bloque
3. **Unirse al Bloque:** Usuario (incluyendo el creador) llama a `CundinaBlock.joinBlock()`
   - El creador contribuye sus tokens como el primer miembro
4. **Completar Bloque:** Cuando el 9º miembro se une
   - Se marcan los tokens correctos (9 × contribución = total)
   - Se distribuyen automáticamente las recompensas

## Contratos

### BlockFactory
Contrato factory que gestiona la creación de bloques y el registro de usuarios.

**Funciones principales:**
- `registerUser()`: Registra un usuario pagando 20 CUNDINA
- `createBlock(levelId)`: Crea un nuevo bloque para un nivel específico
- `getUserBlocks(address)`: Obtiene todos los bloques de un usuario
- `getLevel(levelId)`: Obtiene información de un nivel

### CundinaBlock
Contrato de bloque individual que gestiona las contribuciones y distribución de recompensas.

**Funciones principales:**
- `joinBlock()`: Unirse al bloque contribuyendo tokens
- `distributeRewards()`: Distribuir recompensas cuando el bloque se complete
- `getMembers()`: Obtener lista de miembros
- `getBlockInfo()`: Obtener información del bloque

## Instalación

```bash
cd contracts
npm install
```

## Configuración

1. Crea un archivo `.env` en el directorio `contracts`:

```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=your_private_key_here
```

2. Actualiza la dirección de la billetera de la plataforma en `scripts/deploy.js`

## Compilación

```bash
npm run compile
```

## Despliegue

```bash
npm run deploy
```

Después del despliegue, copia la dirección del BlockFactory y agrégala a tu archivo `.env` principal:

```
VITE_BLOCK_FACTORY_ADDRESS=0x...
```

## Testing

```bash
npm run test
```

## Niveles Configurados

1. **Nivel 1 - Curioso**: 9 miembros × 20 CUNDINA = 180 CUNDINA
2. **Nivel 2 - Aprendiz**: 9 miembros × 45 CUNDINA = 405 CUNDINA
3. **Nivel 3 - Experimentado**: 9 miembros × 90 CUNDINA = 810 CUNDINA
4. **Nivel 4 - Profesional**: 9 miembros × 180 CUNDINA = 1,620 CUNDINA
5. **Nivel 5 - Experto**: 9 miembros × 360 CUNDINA = 3,240 CUNDINA
6. **Nivel 6 - Maestro**: 9 miembros × 720 CUNDINA = 6,480 CUNDINA
7. **Nivel 7 - Leyenda**: 9 miembros × 750 CUNDINA = 6,750 CUNDINA

## Seguridad

- Todos los contratos usan OpenZeppelin para seguridad
- ReentrancyGuard para prevenir ataques de reentrada
- Ownable para control de acceso
- Validaciones de estado en todas las funciones críticas
