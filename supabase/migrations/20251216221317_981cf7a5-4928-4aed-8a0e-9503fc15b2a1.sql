-- Agregar columnas para la dispersión de fondos al avanzar
ALTER TABLE public.levels 
ADD COLUMN advance_contribution numeric DEFAULT 0,
ADD COLUMN advance_commission numeric DEFAULT 0,
ADD COLUMN advance_to_wallet numeric DEFAULT 0;

-- Actualizar valores según especificación
-- Nivel 1: Saldo $162, Aporte $45, Comisión $5, Billetera $112
UPDATE public.levels SET advance_contribution = 45, advance_commission = 5, advance_to_wallet = 112 WHERE id = 1;

-- Nivel 2: Saldo $360, Aporte $90, Comisión $10, Billetera $260
UPDATE public.levels SET advance_contribution = 90, advance_commission = 10, advance_to_wallet = 260 WHERE id = 2;

-- Nivel 3: Saldo $630, Aporte $225, Comisión $25, Billetera $380
UPDATE public.levels SET advance_contribution = 225, advance_commission = 25, advance_to_wallet = 380 WHERE id = 3;

-- Nivel 4: Saldo $1350, Aporte $450, Comisión $50, Billetera $850
UPDATE public.levels SET advance_contribution = 450, advance_commission = 50, advance_to_wallet = 850 WHERE id = 4;

-- Nivel 5: Saldo $2250, Aporte $900, Comisión $100, Billetera $1250
UPDATE public.levels SET advance_contribution = 900, advance_commission = 100, advance_to_wallet = 1250 WHERE id = 5;

-- Nivel 6: Saldo $3600, Aporte $2250, Comisión $250, Billetera $1100
UPDATE public.levels SET advance_contribution = 2250, advance_commission = 250, advance_to_wallet = 1100 WHERE id = 6;

-- Nivel 7: Saldo $6750, Aporte $250 (Sociedad), Comisión $650, Billetera $5850
UPDATE public.levels SET advance_contribution = 250, advance_commission = 650, advance_to_wallet = 5850 WHERE id = 7;