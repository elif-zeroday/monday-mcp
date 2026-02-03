/**
 * Script to test the webhook handler locally
 * 
 * Usage: 
 *   Test with specific subitem: MONDAY_TOKEN=xxx SUBITEM_ID=18050734484 npm run test-local
 *   
 * This script:
 * 1. Fetches the subitem details
 * 2. Simulates what the webhook handler would do
 * 3. Logs the results (use DRY_RUN=true to avoid making changes)
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const SUBITEM_ID = process.env.SUBITEM_ID;
const DRY_RUN = process.env.DRY_RUN === 'true';

// Board and column IDs
const SUBITEM_BOARD_ID = 18041802160;
const FEATURE_BOARD_ID = 18041801957;
const MAIN_BOARD_ID = 18012438587;
const SUBITEM_TO_MAIN_COLUMN = 'board_relation_mkw4vrjt';
const MAIN_TO_FEATURE_COLUMN = 'board_relation_mkw8vvdh';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function mondayQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_TOKEN!,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const result = (await response.json()) as GraphQLResponse<T>;
  
  if (result.errors) {
    throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
  }
  
  if (!result.data) {
    throw new Error('No data in response');
  }
  
  return result.data;
}

interface SubitemData {
  items: Array<{
    id: string;
    name: string;
    parent_item?: {
      id: string;
      name: string;
      board: {
        id: string;
        name: string;
      };
    };
    column_values: Array<{
      id: string;
      value: string | null;
    }>;
  }>;
}

interface MainItemData {
  items: Array<{
    id: string;
    name: string;
    column_values: Array<{
      id: string;
      value: string | null;
    }>;
  }>;
}

async function testWebhook(): Promise<void> {
  if (!MONDAY_TOKEN) {
    console.error('ERROR: MONDAY_TOKEN environment variable is required');
    process.exit(1);
  }
  
  if (!SUBITEM_ID) {
    console.error('ERROR: SUBITEM_ID environment variable is required');
    console.error('Usage: SUBITEM_ID=18050734484 npm run test-local');
    process.exit(1);
  }
  
  console.log('='.repeat(60));
  console.log('WEBHOOK HANDLER TEST');
  console.log('='.repeat(60));
  console.log(`Subitem ID: ${SUBITEM_ID}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log('');
  
  // Step 1: Fetch subitem with parent and linked items
  console.log('Step 1: Fetching subitem details...');
  const subitemQuery = `
    query GetSubitem($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        parent_item {
          id
          name
          board {
            id
            name
          }
        }
        column_values(ids: ["${SUBITEM_TO_MAIN_COLUMN}"]) {
          id
          value
        }
      }
    }
  `;
  
  const subitemResult = await mondayQuery<SubitemData>(subitemQuery, {
    itemId: [SUBITEM_ID],
  });
  
  const subitem = subitemResult.items[0];
  if (!subitem) {
    console.error(`ERROR: Subitem ${SUBITEM_ID} not found`);
    process.exit(1);
  }
  
  console.log(`  Name: ${subitem.name}`);
  console.log(`  Parent: ${subitem.parent_item?.name || 'N/A'} (ID: ${subitem.parent_item?.id || 'N/A'})`);
  console.log(`  Parent Board: ${subitem.parent_item?.board?.name || 'N/A'} (ID: ${subitem.parent_item?.board?.id || 'N/A'})`);
  
  // Parse linked main items
  const relationColumn = subitem.column_values.find(col => col.id === SUBITEM_TO_MAIN_COLUMN);
  let linkedMainItemIds: number[] = [];
  
  if (relationColumn?.value) {
    try {
      const parsed = JSON.parse(relationColumn.value);
      linkedMainItemIds = parsed.linkedPulseIds?.map((p: { linkedPulseId: number }) => p.linkedPulseId) || [];
    } catch {
      console.error('  ERROR: Failed to parse relation column value');
    }
  }
  
  console.log(`  Linked Main Items: ${linkedMainItemIds.length > 0 ? linkedMainItemIds.join(', ') : 'None'}`);
  console.log('');
  
  // Validate parent board
  if (!subitem.parent_item) {
    console.error('ERROR: Subitem has no parent');
    process.exit(1);
  }
  
  const parentBoardId = parseInt(subitem.parent_item.board.id, 10);
  if (parentBoardId !== FEATURE_BOARD_ID) {
    console.error(`ERROR: Parent board ${parentBoardId} is not the Feature board ${FEATURE_BOARD_ID}`);
    process.exit(1);
  }
  
  const parentId = parseInt(subitem.parent_item.id, 10);
  
  if (linkedMainItemIds.length === 0) {
    console.log('No linked main items to process. Done.');
    process.exit(0);
  }
  
  // Step 2: Check each main item and update if needed
  console.log('Step 2: Processing linked main items...');
  
  for (const mainItemId of linkedMainItemIds) {
    console.log('');
    console.log(`  Processing Main Item ${mainItemId}...`);
    
    const mainItemQuery = `
      query GetMainItem($itemId: [ID!]!) {
        items(ids: $itemId) {
          id
          name
          column_values(ids: ["${MAIN_TO_FEATURE_COLUMN}"]) {
            id
            value
          }
        }
      }
    `;
    
    const mainItemResult = await mondayQuery<MainItemData>(mainItemQuery, {
      itemId: [String(mainItemId)],
    });
    
    const mainItem = mainItemResult.items[0];
    if (!mainItem) {
      console.log(`    WARNING: Main item ${mainItemId} not found, skipping`);
      continue;
    }
    
    console.log(`    Name: ${mainItem.name}`);
    
    // Get existing linked feature items
    const mainRelationColumn = mainItem.column_values.find(col => col.id === MAIN_TO_FEATURE_COLUMN);
    let existingLinkedIds: number[] = [];
    
    if (mainRelationColumn?.value) {
      try {
        const parsed = JSON.parse(mainRelationColumn.value);
        existingLinkedIds = parsed.linkedPulseIds?.map((p: { linkedPulseId: number }) => p.linkedPulseId) || [];
      } catch {
        console.log('    WARNING: Failed to parse existing links');
      }
    }
    
    console.log(`    Existing Feature Links: ${existingLinkedIds.length > 0 ? existingLinkedIds.join(', ') : 'None'}`);
    
    // Check if parent is already linked
    if (existingLinkedIds.includes(parentId)) {
      console.log(`    ✓ Parent ${parentId} already linked, SKIPPING`);
      continue;
    }
    
    // Merge and dedupe
    const mergedLinkedIds = [...new Set([...existingLinkedIds, parentId])];
    
    console.log(`    Action: Add parent ${parentId} to links`);
    console.log(`    New Links: ${mergedLinkedIds.join(', ')}`);
    
    if (DRY_RUN) {
      console.log(`    [DRY-RUN] Would update column ${MAIN_TO_FEATURE_COLUMN}`);
    } else {
      // Actually update
      const mutation = `
        mutation UpdateMainItem($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
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
      
      const columnValue = JSON.stringify({ item_ids: mergedLinkedIds });
      
      await mondayQuery(mutation, {
        boardId: String(MAIN_BOARD_ID),
        itemId: String(mainItemId),
        columnId: MAIN_TO_FEATURE_COLUMN,
        value: columnValue,
      });
      
      console.log(`    ✓ Updated successfully!`);
    }
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

testWebhook().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
