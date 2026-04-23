import { prisma } from '../db';

export async function writeAutomationLog(
  name: string,
  businessProfileId: string,
  startTime: string,
  itemsProcessed: number,
  status: 'success' | 'failed' = 'success',
  errorMessage?: string
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
      },
    });
  } catch (e: any) {
    console.error(`AutomationLog write failed for ${name}:`, e.message);
  }
}
