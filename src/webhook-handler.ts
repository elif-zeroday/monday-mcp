import { config } from './config';
import { logger } from './logger';
import {
  getSubitemWithParent,
  getMainItemLinkedIds,
  updateMainItemLinks,
  parseLinkedItemIds,
} from './monday-client';

// ============================================================================
// Webhook Event Types
// ============================================================================

interface WebhookEvent {
  event: {
    userId: number;
    originalTriggerUuid?: string;
    boardId: number;
    groupId?: string;
    pulseId: number;
    pulseName: string;
    columnId: string;
    columnType: string;
    columnTitle: string;
    value?: {
      linkedPulseIds?: Array<{ linkedPulseId: number }>;
    };
    previousValue?: {
      linkedPulseIds?: Array<{ linkedPulseId: number }>;
    };
    changedAt?: number;
    isTopGroup?: boolean;
    triggerTime?: string;
    subscriptionId?: number;
    triggerUuid?: string;
  };
}

interface WebhookChallenge {
  challenge: string;
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Process a webhook event for the subitem link automation
 */
export async function handleWebhookEvent(
  payload: WebhookEvent | WebhookChallenge,
  requestId: string
): Promise<{ challenge?: string; success?: boolean; message?: string; dryRun?: boolean }> {
  // Handle webhook challenge (initial registration verification)
  if ('challenge' in payload) {
    logger.info('Responding to webhook challenge', { requestId });
    return { challenge: payload.challenge };
  }
  
  const event = payload.event;
  
  // Log incoming event
  logger.info('Received webhook event', {
    requestId,
    subitemId: event.pulseId,
    boardId: event.boardId,
    columnId: event.columnId,
  });
  
  // Validate board ID
  if (event.boardId !== config.boards.subitem) {
    logger.warn('Ignoring event from unexpected board', {
      requestId,
      expectedBoard: config.boards.subitem,
      actualBoard: event.boardId,
    });
    return { success: false, message: 'Event from unexpected board' };
  }
  
  // Validate column ID
  if (event.columnId !== config.columns.subitemToMain) {
    logger.debug('Ignoring event for non-target column', {
      requestId,
      expectedColumn: config.columns.subitemToMain,
      actualColumn: event.columnId,
    });
    return { success: false, message: 'Event for non-target column' };
  }
  
  // Get linked main item IDs from the event value
  const linkedMainItemIds = event.value?.linkedPulseIds?.map(p => p.linkedPulseId) || [];
  
  if (linkedMainItemIds.length === 0) {
    logger.info('No linked main items in event, nothing to do', { requestId, subitemId: event.pulseId });
    return { success: true, message: 'No linked items to process' };
  }
  
  logger.info('Processing subitem link change', {
    requestId,
    subitemId: event.pulseId,
    mainItemIds: linkedMainItemIds,
  });
  
  // Fetch subitem details including parent item
  const subitem = await getSubitemWithParent(event.pulseId, requestId);
  
  if (!subitem) {
    logger.error('Failed to fetch subitem', { requestId, subitemId: event.pulseId });
    return { success: false, message: 'Failed to fetch subitem' };
  }
  
  if (!subitem.parent_item) {
    logger.warn('Subitem has no parent item', { requestId, subitemId: event.pulseId });
    return { success: false, message: 'Subitem has no parent item' };
  }
  
  const parentId = parseInt(subitem.parent_item.id, 10);
  const parentBoardId = parseInt(subitem.parent_item.board.id, 10);
  
  // Validate parent is from the Feature board
  if (parentBoardId !== config.boards.feature) {
    logger.warn('Parent item is not from Feature board, ignoring', {
      requestId,
      subitemId: event.pulseId,
      parentId,
      expectedBoard: config.boards.feature,
      actualBoard: parentBoardId,
    });
    return { success: false, message: 'Parent item not from expected Feature board' };
  }
  
  logger.info('Found parent item', {
    requestId,
    subitemId: event.pulseId,
    parentId,
    parentBoardId,
  });
  
  // Process each linked main item
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const mainItemId of linkedMainItemIds) {
    try {
      // Get existing linked item IDs on the main item
      const existingLinkedIds = await getMainItemLinkedIds(mainItemId, requestId);
      
      logger.debug('Existing links on main item', {
        requestId,
        mainItemId,
        existingLinkedIds,
      });
      
      // Check if parent is already linked
      if (existingLinkedIds.includes(parentId)) {
        logger.info('Parent already linked to main item, skipping', {
          requestId,
          mainItemId,
          parentId,
        });
        skippedCount++;
        continue;
      }
      
      // Merge and dedupe
      const mergedLinkedIds = [...new Set([...existingLinkedIds, parentId])];
      
      logger.info('Updating main item with parent link', {
        requestId,
        mainItemId,
        parentId,
        existingCount: existingLinkedIds.length,
        newCount: mergedLinkedIds.length,
        dryRun: config.dryRun,
      });
      
      if (config.dryRun) {
        logger.info('[DRY-RUN] Would update main item links', {
          requestId,
          mainItemId,
          mergedLinkedIds,
        });
      } else {
        await updateMainItemLinks(mainItemId, config.boards.main, mergedLinkedIds, requestId);
      }
      
      updatedCount++;
    } catch (error) {
      logger.error('Failed to update main item', {
        requestId,
        mainItemId,
        parentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  logger.info('Finished processing webhook event', {
    requestId,
    subitemId: event.pulseId,
    parentId,
    mainItemIds: linkedMainItemIds,
    updatedCount,
    skippedCount,
    dryRun: config.dryRun,
  });
  
  return {
    success: true,
    message: `Updated ${updatedCount} main items, skipped ${skippedCount}`,
    dryRun: config.dryRun,
  };
}
