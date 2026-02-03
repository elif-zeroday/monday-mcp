import fetch from 'node-fetch';
import { config } from './config';
import { logger } from './logger';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: string[] }>;
  account_id?: number;
}

/**
 * Execute a GraphQL query/mutation against Monday.com API with retry logic
 */
export async function mondayQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  requestId?: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    try {
      const response = await fetch(config.mondayApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.mondayToken,
          'API-Version': '2024-10',
        },
        body: JSON.stringify({ query, variables }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = (await response.json()) as GraphQLResponse<T>;
      
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map(e => e.message).join(', ');
        throw new Error(`GraphQL errors: ${errorMessages}`);
      }
      
      if (!result.data) {
        throw new Error('No data in response');
      }
      
      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      logger.warn(`Monday API call failed (attempt ${attempt}/${config.retry.maxAttempts})`, {
        requestId,
        error: lastError.message,
      });
      
      if (attempt < config.retry.maxAttempts) {
        // Exponential backoff with jitter
        const delay = Math.min(
          config.retry.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500,
          config.retry.maxDelayMs
        );
        await sleep(delay);
      }
    }
  }
  
  throw lastError || new Error('Unknown error during API call');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// GraphQL Queries and Types
// ============================================================================

interface SubitemWithParent {
  id: string;
  name: string;
  parent_item?: {
    id: string;
    board: {
      id: string;
    };
  };
  column_values: Array<{
    id: string;
    value: string | null;
    type: string;
  }>;
}

interface SubitemQueryResponse {
  items: SubitemWithParent[];
}

/**
 * Fetch a subitem with its parent item and linked items from the relation column
 */
export async function getSubitemWithParent(
  subitemId: number,
  requestId?: string
): Promise<SubitemWithParent | null> {
  const query = `
    query GetSubitemWithParent($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        parent_item {
          id
          board {
            id
          }
        }
        column_values(ids: ["${config.columns.subitemToMain}"]) {
          id
          value
          type
        }
      }
    }
  `;
  
  const result = await mondayQuery<SubitemQueryResponse>(query, {
    itemId: [String(subitemId)],
  }, requestId);
  
  return result.items[0] || null;
}

interface MainItemRelations {
  id: string;
  name: string;
  column_values: Array<{
    id: string;
    value: string | null;
    type: string;
  }>;
}

interface MainItemsQueryResponse {
  items: MainItemRelations[];
}

/**
 * Fetch existing linked item IDs from main item's relation column
 */
export async function getMainItemLinkedIds(
  mainItemId: number,
  requestId?: string
): Promise<number[]> {
  const query = `
    query GetMainItemLinks($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        column_values(ids: ["${config.columns.mainToFeature}"]) {
          id
          value
          type
        }
      }
    }
  `;
  
  const result = await mondayQuery<MainItemsQueryResponse>(query, {
    itemId: [String(mainItemId)],
  }, requestId);
  
  const mainItem = result.items[0];
  if (!mainItem) {
    return [];
  }
  
  const relationColumn = mainItem.column_values.find(
    col => col.id === config.columns.mainToFeature
  );
  
  if (!relationColumn || !relationColumn.value) {
    return [];
  }
  
  try {
    const parsed = JSON.parse(relationColumn.value);
    // Board relation column value format: { "linkedPulseIds": [{ "linkedPulseId": 123 }, ...] }
    if (parsed?.linkedPulseIds && Array.isArray(parsed.linkedPulseIds)) {
      return parsed.linkedPulseIds.map((item: { linkedPulseId: number }) => item.linkedPulseId);
    }
  } catch {
    logger.warn('Failed to parse relation column value', {
      requestId,
      mainItemId,
      value: relationColumn.value,
    });
  }
  
  return [];
}

interface ChangeColumnValueResponse {
  change_column_value: {
    id: string;
  };
}

/**
 * Update a board relation column to include additional linked item IDs
 */
export async function updateMainItemLinks(
  mainItemId: number,
  boardId: number,
  linkedItemIds: number[],
  requestId?: string
): Promise<void> {
  // Format the column value for board_relation type
  // Format: { "item_ids": [123, 456] }
  const columnValue = JSON.stringify({
    item_ids: linkedItemIds,
  });
  
  const mutation = `
    mutation UpdateMainItemLinks($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;
  
  await mondayQuery<ChangeColumnValueResponse>(mutation, {
    boardId: String(boardId),
    itemId: String(mainItemId),
    columnId: config.columns.mainToFeature,
    value: columnValue,
  }, requestId);
}

/**
 * Parse linked item IDs from a board_relation column value
 */
export function parseLinkedItemIds(columnValue: string | null): number[] {
  if (!columnValue) {
    return [];
  }
  
  try {
    const parsed = JSON.parse(columnValue);
    // Board relation column value format: { "linkedPulseIds": [{ "linkedPulseId": 123 }, ...] }
    if (parsed?.linkedPulseIds && Array.isArray(parsed.linkedPulseIds)) {
      return parsed.linkedPulseIds.map((item: { linkedPulseId: number }) => item.linkedPulseId);
    }
  } catch {
    // Invalid JSON or unexpected format
  }
  
  return [];
}
