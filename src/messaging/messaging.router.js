import { Router } from 'express';
import {
  getConversationsForUser,
  findConversation,
  createConversation,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  getTotalUnreadCount,
  getConversationById,
  getContacts,
  resolveUserAliases
} from './messaging.db.js';

const router = Router();

// ─── GET /contacts — List available contacts (freelancers + clients) ──
router.get('/contacts', async (req, res) => {
  try {
    const { userId } = req.query;
    const contacts = await getContacts(userId || null);
    res.json({ success: true, contacts });
  } catch (err) {
    console.error('[Messaging] Error fetching contacts:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
  }
});

// ─── GET /conversations — List all conversations for a user ──
router.get('/conversations', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    const conversations = await getConversationsForUser(userId);
    res.json({ success: true, conversations });
  } catch (err) {
    console.error('[Messaging] Error fetching conversations:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversations', details: err.message });
  }
});

// ─── GET /conversations/:id/messages — Get messages for a conversation ──
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    // Security Authorization Check: Verify user is a participant of this conversation
    const conv = await getConversationById(id);
    if (conv) {
      const userAliases = await resolveUserAliases(userId);
      const isPart1 = userAliases.includes(String(conv.participant_1_id));
      const isPart2 = userAliases.includes(String(conv.participant_2_id));
      if (!isPart1 && !isPart2) {
        const conversations = await getConversationsForUser(userId);
        const hasAccess = conversations.some(c => c.id === id);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: You are not a participant in this conversation' });
        }
      }
    }

    const messages = await getMessages(id);

    // Automatically mark messages as read
    try {
      await markMessagesAsRead(id, userId);
    } catch (markErr) {
      console.warn('[Messaging] Could not mark messages as read:', markErr.message);
    }

    res.json({ success: true, messages });
  } catch (err) {
    console.error('[Messaging] Error fetching messages:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
});

// ─── POST /conversations — Create or find existing conversation ──
router.post('/conversations', async (req, res) => {
  try {
    const { participant1, participant2, jobId } = req.body;

    if (!participant1?.id || !participant2?.id) {
      return res.status(400).json({ error: 'Both participant1 and participant2 with id are required' });
    }

    // Check if a conversation already exists between these two users
    let conversation = await findConversation(participant1.id, participant2.id);

    if (conversation) {
      return res.json({ success: true, conversation, existing: true });
    }

    // Create new conversation
    conversation = await createConversation({ participant1, participant2, jobId });
    res.json({ success: true, conversation, existing: false });
  } catch (err) {
    console.error('[Messaging] Error creating conversation:', err.message);
    res.status(500).json({ error: 'Failed to create conversation', details: err.message });
  }
});

// ─── POST /send — Send a message (text + attachments) ──
router.post('/send', async (req, res) => {
  try {
    const { 
      conversationId, 
      senderId, 
      senderName, 
      senderAvatar, 
      content,
      attachmentUrl,
      fileName,
      fileType,
      fileSize,
      mimeType,
      storagePath
    } = req.body;

    if (!conversationId || !senderId) {
      return res.status(400).json({ error: 'conversationId and senderId are required' });
    }

    if (!content && !attachmentUrl) {
      return res.status(400).json({ error: 'Either message content or attachmentUrl is required' });
    }

    // Authorization check: sender must be in the conversation
    const conv = await getConversationById(conversationId);
    if (conv) {
      const senderAliases = await resolveUserAliases(senderId);
      const isPart1 = senderAliases.includes(String(conv.participant_1_id));
      const isPart2 = senderAliases.includes(String(conv.participant_2_id));
      if (!isPart1 && !isPart2) {
        const conversations = await getConversationsForUser(senderId);
        const hasAccess = conversations.some(c => c.id === conversationId);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized: Sender is not a participant in this conversation' });
        }
      }
    }

    const message = await sendMessage({
      conversationId,
      senderId,
      senderName: senderName || '',
      senderAvatar: senderAvatar || '',
      content: content || '',
      attachmentUrl: attachmentUrl || null,
      fileName: fileName || null,
      fileType: fileType || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      storagePath: storagePath || null
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error('[Messaging] Error sending message:', err.message);
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// ─── POST /mark-read — Mark messages as read for a user ──
router.post('/mark-read', async (req, res) => {
  try {
    const { conversationId, userId } = req.body;

    if (!conversationId || !userId) {
      return res.status(400).json({ error: 'conversationId and userId are required' });
    }

    await markMessagesAsRead(conversationId, userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[Messaging] Error marking messages read:', err.message);
    res.status(500).json({ error: 'Failed to mark messages as read', details: err.message });
  }
});

// ─── GET /unread-count — Total unread count for a user ──
router.get('/unread-count', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    const count = await getTotalUnreadCount(userId);
    res.json({ success: true, count });
  } catch (err) {
    console.error('[Messaging] Error fetching unread count:', err.message);
    res.status(500).json({ error: 'Failed to fetch unread count', details: err.message });
  }
});

export default router;
