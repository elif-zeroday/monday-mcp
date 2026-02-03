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
    // For change_subitem_column_value events:
    // - pulseId is the PARENT item id
    // - subitemId is the actual subitem that changed
    pulseId: number;
    pulseName: string;
    subitemId?: number;        // The subitem that was changed
    subitemName?: string;      // Name of the subitem
    subitemBoardId?: number;   // Board ID of subitems
    parentItemId?: number;     // Same as pulseId for subitem events
    parentItemBoardId?: number;// Parent board ID
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
  
  // For change_subitem_column_value events:
  // - boardId is the PARENT board (Feature Board)
  // - subitemId is the subitem that changed
  // - pulseId is the parent item
  const subitemId = event.subitemId || event.pulseId;
  const parentItemId = event.parentItemId || event.pulseId;
  
  // Log incoming event
  logger.info('Received webhook event', {
    requestId,
    subitemId,
    parentItemId,
    boardId: event.boardId,
    subitemBoardId: event.subitemBoardId,
    columnId: event.columnId,
  });
  
  // For change_subitem_column_value events, Monday sends boardId as the SUBITEM board
  // We need to accept events from the subitem board (18041802160)
  // The parent board validation happens later when we fetch the subitem's parent
  if (event.boardId !== config.boards.subitem && event.boardId !== config.boards.feature) {
    logger.warn('Ignoring event from unexpected board', {
      requestId,
      expectedBoards: [config.boards.subitem, config.boards.feature],
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
    logger.info('No linked main items in event, nothing to do', { requestId, subitemId });
    return { success: true, message: 'No linked items to process' };
  }
  
  logger.info('Processing subitem link change', {
    requestId,
    subitemId,
    mainItemIds: linkedMainItemIds,
  });
  
  // For change_subitem_column_value, we may already have the parent info
  // But let's fetch to be sure and get the full details
  const subitem = await getSubitemWithParent(subitemId, requestId);
  
  if (!subitem) {
    logger.error('Failed to fetch subitem', { requestId, subitemId });
    return { success: false, message: 'Failed to fetch subitem' };
  }
  
  // Use parent from API response, or fall back to event data
  let parentId: number;
  let parentBoardId: number;
  
  if (subitem.parent_item) {
    parentId = parseInt(subitem.parent_item.id, 10);
    parentBoardId = parseInt(subitem.parent_item.board.id, 10);
  } else if (event.parentItemId && event.parentItemBoardId) {
    // Fallback to event data
    parentId = event.parentItemId;
    parentBoardId = event.parentItemBoardId;
  } else if (event.pulseId && event.boardId) {
    // For subitem events, pulseId is the parent
    parentId = event.pulseId;
    parentBoardId = event.boardId;
  } else {
    logger.warn('Subitem has no parent item info', { requestId, subitemId });
    return { success: false, message: 'Subitem has no parent item' };
  }
  
  // Validate parent is from the Feature board
  if (parentBoardId !== config.boards.feature) {
    logger.warn('Parent item is not from Feature board, ignoring', {
      requestId,
      subitemId,
      parentId,
      expectedBoard: config.boards.feature,
      actualBoard: parentBoardId,
    });
    return { success: false, message: 'Parent item not from expected Feature board' };
  }
  
  logger.info('Found parent item', {
    requestId,
    subitemId,
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
    subitemId,
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
