import { prisma } from '../db';

export async function writeAutomationLog(
  name: string,
  businessProfileId: string,
  startTime: string,
  itemsProcessed: number,
  status: 'success' | 'failed' = 'success',
  errorMessage?: string,
  costUsd?: number,
) {
  try {
    await prisma.automationLog.create({
      data: {
        automation_name: name,
        start_time: startTime,
        end_time: new Date().toISOString(),
        status,
        items_processed: itemsProcessed,
        error_message: errorMessage || null,
        linked_business: businessProfileId,
        cost_usd: costUsd ?? null,
      },
    });
  } catch (e: any) {
    console.error(`AutomationLog write failed for ${name}:`, e.message);
  }
}

// ponytail: migration-window only — remove this + DUAL_WRITE_AUTOMATION_LOG when alias period ends
export async function writeAutomationLogDual(
  canonical: string,
  legacy: string,
  businessProfileId: string,
  startTime: string,
  itemsProcessed: number,
  status: 'success' | 'failed' = 'success',
  errorMessage?: string,
  costUsd?: number,
) {
  await writeAutomationLog(canonical, businessProfileId, startTime, itemsProcessed, status, errorMessage, costUsd);
  if (process.env.DUAL_WRITE_AUTOMATION_LOG === 'true') {
    await writeAutomationLog(legacy, businessProfileId, startTime, itemsProcessed, status, errorMessage, costUsd);
  }
}
