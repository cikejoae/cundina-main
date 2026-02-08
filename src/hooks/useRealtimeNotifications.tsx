import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { RealtimeChannel } from '@supabase/supabase-js';

export const useRealtimeNotifications = () => {
  const { user } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync notifications from subgraph periodically
  useEffect(() => {
    if (!user) return;

    const syncNotifications = async () => {
      try {
        await supabase.functions.invoke('sync-notifications');
      } catch (err) {
        // Silent fail - this is background sync
        console.debug('[Notifications] Sync error:', err);
      }
    };

    // Initial sync after a short delay
    const timeout = setTimeout(syncNotifications, 5000);
    
    // Sync every 5 minutes
    syncIntervalRef.current = setInterval(syncNotifications, 5 * 60 * 1000);

    return () => {
      clearTimeout(timeout);
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [user]);

  // Listen for realtime notification inserts
  useEffect(() => {
    if (!user) return;
    if (channelRef.current) return;

    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = payload.new as any;
          if (notification) {
            const toastFn = notification.type === 'success' ? toast.success 
              : notification.type === 'error' ? toast.error 
              : toast.info;
            toastFn(notification.title, {
              description: notification.message,
              duration: 6000,
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [user]);
};
