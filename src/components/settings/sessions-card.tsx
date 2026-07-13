'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function SessionsCard() {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      // scope: 'global' revokes every refresh token for this user
      // across all devices; the next auth-state change on this tab
      // triggers the usual redirect.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        toast.error(`No se pudo cerrar sesión: ${error.message}`);
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(msg);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <LogOut className="size-4 text-primary" />
            Sesiones activas
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Cerrá sesión en todos los dispositivos donde estás conectado —
            incluido este. Útil si perdiste una laptop o compartiste tu
            contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            <LogOut className="size-4" />
            Cerrar sesión en todos los dispositivos
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cerrar sesión en todos lados?</DialogTitle>
            <DialogDescription>
              Todos los dispositivos conectados a esta cuenta van a cerrar
              sesión y van a necesitar iniciar sesión de nuevo. Vas a ser
              redirigido a la página de inicio de sesión.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={onConfirm} disabled={signingOut}>
              {signingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Cerrando sesión…
                </>
              ) : (
                'Cerrar sesión en todos lados'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
