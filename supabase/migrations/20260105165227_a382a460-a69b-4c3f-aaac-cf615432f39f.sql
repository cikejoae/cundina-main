
-- Trigger para actualizar current_members automáticamente cuando se inserta/elimina un block_member
CREATE TRIGGER trigger_update_block_member_count
AFTER INSERT OR DELETE ON public.block_members
FOR EACH ROW
EXECUTE FUNCTION public.update_block_member_count();

-- Trigger para sincronizar el progreso del creador cuando un bloque se completa
CREATE TRIGGER trigger_sync_block_completion
AFTER UPDATE ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.sync_block_completion_to_progress();

-- Trigger para validar progresión de nivel al crear bloques
CREATE TRIGGER trigger_validate_block_level_progression
BEFORE INSERT ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.validate_block_level_progression();
