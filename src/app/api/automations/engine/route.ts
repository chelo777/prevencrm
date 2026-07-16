import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Admin-only: this fires account-wide automations
 * (send messages, move deals) over ANY contact_id in the account, so a
 * plain agent must not reach it — otherwise an asesora could run actions
 * on leads assigned to other advisors. The real, automatic firing path
 * is the WhatsApp webhook + cron (server-side, no session), untouched.
 */
export async function POST(request: Request) {
  let accountId: string
  try {
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json({ error: 'trigger_type required' }, { status: 400 })
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
