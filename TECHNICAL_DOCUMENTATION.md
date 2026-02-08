# Cundina Block - Documentación Técnica Completa

## 📋 Índice

1. [Descripción General](#descripción-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Stack Tecnológico](#stack-tecnológico)
4. [Estructura del Proyecto](#estructura-del-proyecto)
5. [Smart Contracts](#smart-contracts)
6. [Base de Datos](#base-de-datos)
7. [Edge Functions](#edge-functions)
8. [Autenticación y Seguridad](#autenticación-y-seguridad)
9. [Flujos de Usuario](#flujos-de-usuario)
10. [Sistema de Niveles](#sistema-de-niveles)
11. [Sistema de Referidos](#sistema-de-referidos)
12. [Configuración y Despliegue](#configuración-y-despliegue)

---

## 1. Descripción General

**Cundina Block** es una plataforma DeFi de ahorro colaborativo basada en blockchain que implementa el concepto tradicional de "tandas" o "cundinas" utilizando smart contracts en la red Ethereum Sepolia.

### Concepto Principal
- Los usuarios crean o se unen a "bloques" que son smart contracts individuales
- Cada bloque requiere 9 miembros que contribuyen tokens CUNDINA
- Al completarse un bloque, el creador recibe los fondos acumulados
- Los miembros que contribuyen reciben un bloque personal para avanzar al siguiente nivel

### Token
- **Nombre**: CUNDINA Token
- **Red**: Ethereum Sepolia (Testnet)
- **Dirección del Token**: `0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7`

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Landing   │  │  Dashboard  │  │   MyBlocks  │  ...         │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                            │                                     │
│  ┌─────────────────────────┴─────────────────────────┐          │
│  │              Context Providers                      │          │
│  │  ┌──────────────┐  ┌──────────────┐               │          │
│  │  │ AuthContext  │  │  Web3Context │               │          │
│  │  └──────────────┘  └──────────────┘               │          │
│  └───────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LOVABLE CLOUD (Supabase)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Database   │  │ Edge Functions│  │     Auth     │          │
│  │  (Postgres)  │  │    (Deno)    │  │   (JWT)      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ETHEREUM SEPOLIA NETWORK                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ BlockFactory │──│ CundinaBlock │  │ CUNDINA Token│          │
│  │   Contract   │  │  (múltiples) │  │   (ERC20)    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Stack Tecnológico

### Frontend
| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| React | ^18.3.1 | Framework UI |
| Vite | Latest | Build tool |
| TypeScript | Latest | Type safety |
| Tailwind CSS | Latest | Styling |
| shadcn/ui | Latest | Componentes UI |
| React Router | ^6.30.1 | Navegación |
| TanStack Query | ^5.83.0 | Data fetching |
| React Hook Form | ^7.61.1 | Formularios |
| Zod | ^3.25.76 | Validación |
| Ethers.js | ^6.15.0 | Interacción blockchain |
| Recharts | ^2.15.4 | Gráficos |
| Framer Motion | - | Animaciones |
| Lucide React | ^0.462.0 | Iconos |
| Sonner | ^1.7.4 | Notificaciones toast |

### Backend (Lovable Cloud / Supabase)
| Componente | Tecnología | Propósito |
|------------|------------|-----------|
| Base de Datos | PostgreSQL | Almacenamiento de datos |
| Autenticación | Supabase Auth | Gestión de usuarios |
| Edge Functions | Deno | Lógica de servidor |
| Realtime | Supabase Realtime | Actualizaciones en tiempo real |

### Blockchain
| Componente | Tecnología | Propósito |
|------------|------------|-----------|
| Red | Ethereum Sepolia | Testnet |
| Smart Contracts | Solidity ^0.8.20 | Lógica on-chain |
| Compilación | Hardhat | Desarrollo de contratos |
| Librería Web3 | Ethers.js v6 | Interacción con blockchain |

---

## 4. Estructura del Proyecto

```
cundina-block/
├── contracts/                    # Smart Contracts
│   ├── BlockFactory.sol          # Factory para crear bloques
│   ├── CundinaBlock.sol          # Contrato de bloque individual
│   ├── hardhat.config.js         # Configuración de Hardhat
│   ├── scripts/
│   │   ├── deploy.js             # Script de despliegue
│   │   └── compile-and-extract.js
│   └── README.md
│
├── src/
│   ├── assets/                   # Recursos estáticos
│   │   └── logo.png
│   │
│   ├── components/               # Componentes React
│   │   ├── ui/                   # Componentes shadcn/ui
│   │   ├── admin/                # Componentes del panel admin
│   │   ├── AuthLinkRouter.tsx
│   │   ├── BlockCompletionModal.tsx
│   │   ├── JoinBlockCard.tsx
│   │   ├── LevelBadge.tsx
│   │   ├── Navigation.tsx
│   │   ├── NotificationBell.tsx
│   │   ├── PaymentCard.tsx
│   │   ├── TransactionHistory.tsx
│   │   ├── WalletComparison.tsx
│   │   ├── WalletManager.tsx
│   │   ├── WalletSelector.tsx
│   │   └── WalletTutorialModal.tsx
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx       # Contexto de autenticación
│   │
│   ├── hooks/
│   │   ├── use-mobile.tsx
│   │   ├── use-toast.ts
│   │   ├── useRealtimeNotifications.tsx
│   │   └── useWeb3.tsx           # Hook principal de Web3
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts         # Cliente Supabase (auto-generado)
│   │       └── types.ts          # Tipos TypeScript (auto-generado)
│   │
│   ├── lib/
│   │   └── utils.ts              # Utilidades (cn, etc.)
│   │
│   ├── pages/                    # Páginas de la aplicación
│   │   ├── Admin.tsx             # Panel de administración
│   │   ├── Auth.tsx              # Login/Registro
│   │   ├── BlockDetail.tsx       # Detalle de bloque
│   │   ├── BlockManager.tsx      # Gestión de bloques
│   │   ├── Connect.tsx           # Conexión de wallet
│   │   ├── Dashboard.tsx         # Dashboard principal
│   │   ├── DeployContracts.tsx   # Deploy de contratos
│   │   ├── InviteMembers.tsx     # Invitar miembros
│   │   ├── Landing.tsx           # Página de inicio
│   │   ├── Levels.tsx            # Información de niveles
│   │   ├── ManageWallets.tsx     # Gestión de wallets
│   │   ├── MyBlocks.tsx          # Mis bloques
│   │   ├── NotFound.tsx          # Página 404
│   │   ├── Profile.tsx           # Perfil de usuario
│   │   ├── Ranking.tsx           # Ranking de usuarios
│   │   └── RegisterForm.tsx      # Formulario de registro
│   │
│   ├── App.tsx                   # Componente principal
│   ├── index.css                 # Estilos globales y tokens
│   ├── main.tsx                  # Punto de entrada
│   └── vite-env.d.ts
│
├── supabase/
│   ├── config.toml               # Configuración de Supabase
│   ├── functions/                # Edge Functions
│   │   ├── advance-level/        # Avance de nivel
│   │   ├── assign-block/         # Asignación de bloques
│   │   ├── blockchain-sync/      # Sincronización blockchain
│   │   ├── delete-auth-users/    # Eliminación de usuarios
│   │   ├── deploy-contracts/     # Deploy de contratos
│   │   └── withdraw-earnings/    # Retiro de ganancias
│   └── migrations/               # Migraciones de BD
│
├── public/
│   ├── favicon.png
│   └── robots.txt
│
├── .env                          # Variables de entorno
├── index.html
├── tailwind.config.ts
├── vite.config.ts
└── package.json
```

---

## 5. Smart Contracts

### 5.1 BlockFactory.sol

**Dirección**: Configurada en `VITE_BLOCK_FACTORY_ADDRESS`

**Propósito**: Contrato factory que gestiona la creación de bloques y registro de usuarios.

```solidity
// Constantes
CUNDINA_TOKEN = 0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7
REGISTRATION_FEE = 20 CUNDINA

// Estructura de Nivel
struct Level {
    uint256 id;
    uint256 requiredMembers;
    uint256 contributionAmount;
    uint256 totalCundina;
}

// Funciones Principales
function registerUser() external
function createBlock(uint256 _levelId) external returns (address)
function getUserBlocks(address _user) external view returns (address[])
function getAllBlocks() external view returns (address[])
function getLevel(uint256 _levelId) external view returns (Level)
function updatePlatformWallet(address _newWallet) external
```

**Eventos**:
- `BlockCreated(address indexed blockAddress, address indexed creator, uint256 levelId)`
- `UserRegistered(address indexed user)`

### 5.2 CundinaBlock.sol

**Propósito**: Contrato individual de bloque que gestiona contribuciones y distribución.

```solidity
// Estados del Bloque
enum BlockStatus { Active, Completed, Distributed }

// Variables de Estado
IERC20 cundinaToken
uint256 levelId
uint256 requiredMembers
uint256 contributionAmount
uint256 totalCundina
address[] members
mapping(address => bool) isMember
mapping(address => uint256) contributions
BlockStatus status
uint256 createdAt
uint256 completedAt

// Funciones Principales
function joinBlock() external           // Unirse al bloque
function withdrawToCreator() external   // Retirar fondos (solo owner)
function getContractBalance() external view returns (uint256)
function getMembers() external view returns (address[])
function getBlockInfo() external view returns (...)
```

**Eventos**:
- `MemberJoined(address indexed member, uint256 contribution)`
- `BlockCompleted(uint256 timestamp)`
- `FundsTransferredToCreator(address indexed creator, uint256 amount)`

### 5.3 Flujo del Smart Contract (v2.0)

```
1. Usuario llama BlockFactory.createBlock(levelId)
   └── Se crea nuevo CundinaBlock
   └── El creador NO es miembro automáticamente

2. Creador aprueba tokens al contrato del bloque
   └── cundinaToken.approve(blockAddress, amount)

3. Creador llama CundinaBlock.joinBlock()
   └── Creador se convierte en primer miembro
   └── Contribuye sus tokens

4. Otros 8 miembros se unen
   └── Cada uno aprueba y llama joinBlock()
   └── Contribuyen tokens

5. Al completarse (9 miembros)
   └── status = Completed
   └── Se emite BlockCompleted event

6. Creador llama withdrawToCreator()
   └── Recibe todos los tokens acumulados
   └── status = Distributed
```

---

## 6. Base de Datos

### 6.1 Esquema de Tablas

#### profiles
```sql
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    whatsapp TEXT,
    telegram TEXT,
    wallet_address TEXT,
    referred_by UUID REFERENCES profiles(id),
    referral_code TEXT NOT NULL UNIQUE,
    dao_votes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### user_wallets
```sql
CREATE TABLE public.user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users,
    wallet_address TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    referred_by_wallet_id UUID REFERENCES user_wallets(id),
    referral_code TEXT NOT NULL DEFAULT generate_wallet_referral_code(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(wallet_address)
);
```

#### levels
```sql
CREATE TABLE public.levels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    contribution_amount NUMERIC NOT NULL,
    required_members INTEGER NOT NULL,
    total_cundina NUMERIC NOT NULL,
    advance_contribution NUMERIC DEFAULT 0,
    advance_commission NUMERIC DEFAULT 0,
    advance_to_wallet NUMERIC DEFAULT 0,
    sort_order INTEGER NOT NULL
);
```

#### blocks
```sql
CREATE TABLE public.blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level_id INTEGER NOT NULL REFERENCES levels(id),
    creator_id UUID NOT NULL REFERENCES auth.users,
    wallet_id UUID REFERENCES user_wallets(id),
    creator_wallet_address TEXT,
    contract_address TEXT,
    status block_status DEFAULT 'active',
    current_members INTEGER DEFAULT 0,
    invited_members_count INTEGER DEFAULT 0,
    assigned_members_count INTEGER DEFAULT 0,
    block_number INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE(wallet_id, level_id)  -- Una wallet solo puede crear un bloque por nivel
);
```

#### block_members
```sql
CREATE TABLE public.block_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id UUID NOT NULL REFERENCES blocks(id),
    user_id UUID NOT NULL REFERENCES auth.users,
    wallet_id UUID REFERENCES user_wallets(id),
    position INTEGER NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(block_id, wallet_id)
);
```

#### user_level_progress
```sql
CREATE TABLE public.user_level_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users,
    wallet_id UUID REFERENCES user_wallets(id),
    level_id INTEGER NOT NULL REFERENCES levels(id),
    block_id UUID REFERENCES blocks(id),
    status level_status DEFAULT 'locked',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
```

#### transactions
```sql
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users,
    wallet_id UUID REFERENCES user_wallets(id),
    block_id UUID REFERENCES blocks(id),
    tx_hash TEXT NOT NULL,
    tx_type TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

#### notifications
```sql
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### user_roles
```sql
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users,
    role app_role NOT NULL,
    UNIQUE(user_id, role)
);
```

#### platform_wallets
```sql
CREATE TABLE public.platform_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    wallet_address TEXT NOT NULL,
    position INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### platform_config
```sql
CREATE TABLE public.platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### admin_section_permissions
```sql
CREATE TABLE public.admin_section_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    section TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 6.2 Enums

```sql
CREATE TYPE app_role AS ENUM ('admin', 'moderator');
CREATE TYPE block_status AS ENUM ('active', 'completed');
CREATE TYPE level_status AS ENUM ('locked', 'active', 'completed');
```

### 6.3 Funciones de Base de Datos

| Función | Propósito |
|---------|-----------|
| `handle_new_user()` | Trigger: Crea perfil, wallet inicial y progreso de nivel al registrar usuario |
| `handle_new_wallet_progress()` | Trigger: Crea progreso de nivel para nueva wallet |
| `update_block_member_count()` | Trigger: Actualiza contador de miembros (excluyendo posición 0) |
| `sync_block_completion_to_progress()` | Trigger: Sincroniza estado de bloque completado con progreso |
| `validate_block_level_progression()` | Trigger: Valida que nivel anterior esté completado |
| `update_invited_members_count()` | Trigger: Incrementa contador de invitados del referidor |
| `ensure_single_primary_wallet()` | Trigger: Asegura solo una wallet primaria por usuario |
| `generate_referral_code()` | Genera código de referido único para perfiles |
| `generate_wallet_referral_code()` | Genera código de referido único para wallets |
| `get_next_platform_wallet()` | Obtiene siguiente wallet de plataforma (round-robin) |
| `get_top_block_for_assignment()` | Obtiene bloque con más slots disponibles para asignación |
| `assign_member_to_top_block()` | Asigna miembro al bloque top según ranking |
| `has_role(user_id, role)` | Verifica si usuario tiene rol específico |

### 6.4 Políticas RLS Principales

```sql
-- Profiles: Solo puede ver/editar su propio perfil
-- Admin puede ver todos
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- Blocks: Usuarios autenticados pueden ver bloques activos
-- Pueden crear/actualizar bloques de sus wallets
CREATE POLICY "Anyone can view active blocks" ON blocks FOR SELECT USING (status = 'active');
CREATE POLICY "Users can create blocks for their wallets" ON blocks FOR INSERT 
    WITH CHECK (EXISTS (SELECT 1 FROM user_wallets WHERE id = blocks.wallet_id AND user_id = auth.uid()));

-- Block Members: Solo pueden ver miembros de bloques donde participan
CREATE POLICY "Users can view block members for their wallets" ON block_members FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_wallets WHERE user_id = auth.uid()));

-- Transactions: Solo pueden ver/crear transacciones de sus wallets
CREATE POLICY "Users can view transactions for their wallets" ON transactions FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_wallets WHERE id = transactions.wallet_id AND user_id = auth.uid()));
```

---

## 7. Edge Functions

### 7.1 assign-block

**Ruta**: `/functions/v1/assign-block`  
**Método**: POST  
**Auth**: JWT requerido

**Propósito**: Asigna un usuario/wallet a un bloque existente o crea uno nuevo.

**Request Body**:
```json
{
    "userId": "uuid",
    "levelId": 1,
    "contractAddress": "0x...",
    "creatorWalletAddress": "0x...",
    "walletId": "uuid"
}
```

**Lógica**:
1. Valida autenticación y propiedad de wallet
2. Verifica que no exista ya un bloque para esa wallet/nivel
3. Busca bloque existente con slots disponibles
4. Si existe: agrega como miembro
5. Si no existe: crea nuevo bloque

### 7.2 blockchain-sync

**Ruta**: `/functions/v1/blockchain-sync`  
**Método**: POST  
**Auth**: JWT requerido

**Propósito**: Sincroniza estado del smart contract con la base de datos.

**Request Body**:
```json
{
    "blockAddress": "0x...",
    "action": "sync" | "listen"
}
```

**Lógica (sync)**:
1. Lee estado del contrato on-chain
2. Actualiza registro del bloque en BD
3. Sincroniza miembros
4. Crea bloques personales para miembros nuevos
5. Actualiza progreso de nivel

### 7.3 advance-level

**Ruta**: `/functions/v1/advance-level`  
**Método**: POST  
**Auth**: JWT requerido

**Propósito**: Gestiona el avance de nivel de un usuario.

### 7.4 withdraw-earnings

**Ruta**: `/functions/v1/withdraw-earnings`  
**Método**: POST  
**Auth**: JWT requerido

**Propósito**: Procesa retiro de ganancias de un bloque completado.

### 7.5 deploy-contracts

**Ruta**: `/functions/v1/deploy-contracts`  
**Método**: POST  
**Auth**: No requerido

**Propósito**: Despliega el BlockFactory en Sepolia.

### 7.6 delete-auth-users

**Ruta**: `/functions/v1/delete-auth-users`  
**Método**: POST  
**Auth**: No requerido (solo para desarrollo)

**Propósito**: Elimina todos los usuarios de auth (solo para testing).

---

## 8. Autenticación y Seguridad

### 8.1 Sistema de Autenticación

- **Proveedor**: Supabase Auth
- **Método**: Email/Password con verificación automática
- **Auto-confirm**: Habilitado para desarrollo

### 8.2 Flujo de Registro

```
1. Usuario llena formulario (nombre, apellido, email, teléfono, wallet)
2. signUp() crea usuario en auth.users con metadata
3. Trigger handle_new_user() ejecuta:
   └── Crea registro en profiles
   └── Crea registro en user_wallets (si wallet proporcionada)
   └── Crea user_level_progress inicial (nivel 1, locked)
   └── Si email es eduardorojas@ecrstudio.co → asigna rol admin
4. Usuario es redirigido a /dashboard
```

### 8.3 Roles y Permisos

| Rol | Permisos |
|-----|----------|
| `admin` | Acceso completo al panel de administración |
| `moderator` | Acceso limitado según configuración |
| Usuario normal | Solo sus propios datos |

### 8.4 Verificación de Wallet

```typescript
// Firma de mensaje para verificar propiedad
const message = `Verificación de wallet Cundina Block\nNonce: ${nonce}`;
const signature = await signer.signMessage(message);
// Se verifica que la firma corresponda a la wallet conectada
```

### 8.5 Políticas de Seguridad (RLS)

- Todas las tablas tienen RLS habilitado
- Usuarios solo acceden a sus propios datos
- Admins tienen acceso extendido vía función `has_role()`
- Restricción: Una wallet solo puede crear un bloque por nivel

---

## 9. Flujos de Usuario

### 9.1 Registro de Usuario

```
Landing → Auth → RegisterForm → Dashboard
              ↓
         signUp() con metadata
              ↓
         Trigger: handle_new_user()
              ↓
         Profile + Wallet + Progress creados
```

### 9.2 Creación de Bloque

```
MyBlocks → Seleccionar Nivel → Confirmar en MetaMask
     ↓
   Verificar wallet conectada
     ↓
   createBlock() on-chain
     ↓
   assign-block edge function
     ↓
   Bloque creado en BD con contract_address
```

### 9.3 Unirse a Bloque

```
Dashboard/Ranking → Ver Bloque → Contribuir
         ↓
   approveTokens() on-chain
         ↓
   joinBlock() on-chain
         ↓
   blockchain-sync edge function
         ↓
   Member agregado + Bloque personal creado
```

### 9.4 Completar Bloque

```
9 miembros se unen
     ↓
Contrato cambia a status = Completed
     ↓
blockchain-sync detecta cambio
     ↓
BD actualiza block.status = 'completed'
     ↓
Trigger actualiza user_level_progress = 'completed'
     ↓
Creador puede llamar withdrawToCreator()
```

---

## 10. Sistema de Niveles

### 10.1 Configuración de Niveles

| Nivel | Nombre | Miembros | Aportación | Total |
|-------|--------|----------|------------|-------|
| 1 | Curioso | 9 | 20 CUNDINA | 180 CUNDINA |
| 2 | Aprendiz | 9 | 45 CUNDINA | 405 CUNDINA |
| 3 | Experimentado | 9 | 90 CUNDINA | 810 CUNDINA |
| 4 | Profesional | 9 | 180 CUNDINA | 1,620 CUNDINA |
| 5 | Experto | 9 | 360 CUNDINA | 3,240 CUNDINA |
| 6 | Maestro | 9 | 720 CUNDINA | 6,480 CUNDINA |
| 7 | Leyenda | 9 | 750 CUNDINA | 6,750 CUNDINA |

### 10.2 Progresión de Niveles

```
locked → active → completed
   ↑         ↑         ↑
 Inicio   Crea      Bloque
         Bloque   Completado
```

### 10.3 Reglas de Avance

- Solo puede crear bloque en nivel N+1 si nivel N está completado
- Validado por trigger `validate_block_level_progression()`
- Al avanzar de nivel, se hace transferencia on-chain

---

## 11. Sistema de Referidos

### 11.1 Estructura

- Cada **wallet** tiene un `referral_code` único
- Al registrarse, usuario puede ingresar código de referido
- Se guarda en `user_wallets.referred_by_wallet_id`

### 11.2 Beneficios del Referidor

- Cuando un referido se registra, incrementa `invited_members_count` del bloque activo del referidor
- Los referidos son asignados al bloque del referidor según disponibilidad

### 11.3 Ranking de Asignación

La función `get_top_block_for_assignment()` ordena bloques por:
1. Mayor cantidad de miembros actuales
2. Fecha de creación más antigua (primero en llegar)

---

## 12. Configuración y Despliegue

### 12.1 Variables de Entorno

**Frontend (.env)**:
```env
VITE_SUPABASE_URL=https://uydwuklfysyaipbitdqj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_SUPABASE_PROJECT_ID=uydwuklfysyaipbitdqj
VITE_BLOCK_FACTORY_ADDRESS=0x...
```

**Edge Functions (Secrets)**:
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
SEPOLIA_RPC_URL
DEPLOYER_PRIVATE_KEY
PLATFORM_WALLET_ADDRESS
```

### 12.2 Despliegue de Smart Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia
```

### 12.3 URLs del Proyecto

- **Preview**: https://id-preview--ba58f06a-18bf-469d-b9d9-c59cf24c7a14.lovable.app
- **Producción**: https://cundina.lovable.app
- **Lovable Project**: https://lovable.dev/projects/ba58f06a-18bf-469d-b9d9-c59cf24c7a14

### 12.4 Configuración de Supabase

```toml
# supabase/config.toml
project_id = "uydwuklfysyaipbitdqj"

[functions.deploy-contracts]
verify_jwt = false

[functions.blockchain-sync]
verify_jwt = true

[functions.assign-block]
verify_jwt = true

[functions.delete-auth-users]
verify_jwt = false

[functions.advance-level]
verify_jwt = true

[functions.withdraw-earnings]
verify_jwt = true
```

---

## Apéndice A: Comandos Útiles

```bash
# Desarrollo
npm run dev                    # Iniciar servidor de desarrollo

# Contratos
cd contracts
npm run compile               # Compilar contratos
npm run deploy                # Desplegar en Sepolia

# Hardhat
npx hardhat clean             # Limpiar cache
npx hardhat verify --network sepolia <address>  # Verificar en Etherscan
```

---

## Apéndice B: Direcciones de Contratos

| Contrato | Red | Dirección |
|----------|-----|-----------|
| CUNDINA Token | Sepolia | `0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7` |
| BlockFactory | Sepolia | Ver `VITE_BLOCK_FACTORY_ADDRESS` |

---

## Apéndice C: Administrador por Defecto

El usuario con email `eduardorojas@ecrstudio.co` recibe automáticamente el rol `admin` al registrarse. Este es el único administrador inicial del sistema y puede designar nuevos administradores desde el panel de administración.

---

*Documento generado automáticamente. Última actualización: Enero 2026*
