import { prisma } from '../db';

export type NotificationType =
  | 'duplicate_receipt'
  | 'suspicious_receipt'
  | 'pending_review'
  | 'receipt_uploaded'
  | 'receipt_verified'
  | 'receipt_approved'
  | 'receipt_rejected'
  | 'session_created'
  | 'session_unbalanced'
  | 'session_ready_for_payout'
  | 'overpayment_detected'
  | 'payout_completed'
  | 'custody_alert'
  | 'closing_difference'
  | 'rate_change'
  | 'system_alert';

export interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  userId?: string;
  recipientRole?: 'all' | 'admin' | 'accountant' | 'custody_officer' | 'data_entry';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Resilient Transactional Notification Dispatcher
 * Persists notifications directly into PostgreSQL.
 * Safe execution: errors in dispatch never rollback the underlying financial transaction.
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    const notification = await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        referenceType: params.referenceType || null,
        referenceId: params.referenceId || null,
        userId: params.userId || null,
        recipientRole: params.recipientRole || 'all',
        priority: params.priority || 'normal',
        isRead: false,
      },
    });
    return notification;
  } catch (error) {
    console.error('[NotificationService] Failed to create notification (non-fatal):', error);
    return null;
  }
}
