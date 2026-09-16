import { supabase } from '../shared/utils/supabase.js';
import { getFreelancerById, getFreelancerByUserId } from '../marketplace/marketplace.db.js';

// In-memory fallback store for offline/local mode
const memoryStore = {
  conversations: [],
  messages: []
};

// Helper for resilient Supabase queries with 2s timeout
async function withTimeout(promise, ms = 2000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

/**
 * Helper: Resolve all possible ID aliases for a user (auth user_id, profile UUID, email)
 */
export async function resolveUserAliases(userId) {
  const aliases = new Set();
  if (!userId) return [];

  const target = String(userId).trim();
  aliases.add(target);

  try {
    if (supabase) {
      const isEmail = target.includes('@');
      
      // 1. Find in users table by id or email
      let userQuery = supabase.from('users').select('id, email');
      if (isEmail) {
        userQuery = userQuery.eq('email', target.toLowerCase());
      } else {
        userQuery = userQuery.eq('id', target);
      }
      const { data: userData } = await withTimeout(userQuery.maybeSingle(), 1500).catch(() => ({ data: null }));
      if (userData) {
        if (userData.id) aliases.add(String(userData.id));
        if (userData.email) {
          aliases.add(String(userData.email));
          aliases.add(String(userData.email).toLowerCase());
        }
      }

      // 2. Find in freelancer_profiles by id, user_id, or email
      let fpQuery = supabase.from('freelancer_profiles').select('id, user_id, email');
      if (isEmail) {
        fpQuery = fpQuery.eq('email', target.toLowerCase());
      } else if (isUuid(target)) {
        fpQuery = fpQuery.or(`id.eq.${target},user_id.eq.${target}`);
      } else {
        fpQuery = fpQuery.eq('user_id', target);
      }
      const { data: fpData } = await withTimeout(fpQuery.maybeSingle(), 1500).catch(() => ({ data: null }));
      if (fpData) {
        if (fpData.id) aliases.add(String(fpData.id));
        if (fpData.user_id) aliases.add(String(fpData.user_id));
        if (fpData.email) {
          aliases.add(String(fpData.email));
          aliases.add(String(fpData.email).toLowerCase());
        }
      }

      // 3. Reverse check emails to find linked user IDs
      const emails = Array.from(aliases).filter(a => typeof a === 'string' && a.includes('@'));
      for (const email of emails) {
        const { data: uByEmail } = await withTimeout(
          supabase.from('users').select('id').eq('email', email.toLowerCase()).maybeSingle(),
          1000
        ).catch(() => ({ data: null }));
        if (uByEmail?.id) aliases.add(String(uByEmail.id));

        const { data: fpByEmail } = await withTimeout(
          supabase.from('freelancer_profiles').select('id, user_id').eq('email', email.toLowerCase()).maybeSingle(),
          1000
        ).catch(() => ({ data: null }));
        if (fpByEmail?.id) aliases.add(String(fpByEmail.id));
        if (fpByEmail?.user_id) aliases.add(String(fpByEmail.user_id));
      }
    }
  } catch (err) {
    console.warn('[Messaging DB] resolveUserAliases error:', err.message);
  }

  return Array.from(aliases);
}

// ─── Contacts ────────────────────────────────────────────────
/**
 * Fetch real contacts (approved freelancers + active users) from Supabase
 */
export async function getContacts(currentUserId) {
  const currentAliases = currentUserId ? await resolveUserAliases(currentUserId) : [];
  const contacts = [];
  const seenIds = new Set(currentAliases);

  try {
    if (supabase) {
      // 1. Fetch freelancers
      const { data: freelancers, error: flErr } = await supabase
        .from('freelancer_profiles')
        .select('user_id, id, user_name, user_avatar, professional_title, email');

      if (!flErr && freelancers) {
        freelancers.forEach(f => {
          const contactId = f.user_id || f.id || f.email;
          if (contactId && !seenIds.has(contactId)) {
            seenIds.add(contactId);
            if (f.id) seenIds.add(f.id);
            if (f.user_id) seenIds.add(f.user_id);
            if (f.email) seenIds.add(f.email);
            contacts.push({
              id: contactId,
              name: f.user_name || 'Freelancer',
              avatar: f.user_avatar || '',
              title: f.professional_title || 'Freelancer Specialist',
              email: f.email
            });
          }
        });
      }

      // 2. Fetch users
      const { data: users, error: usrErr } = await supabase
        .from('users')
        .select('id, name, avatar, role, email');

      if (!usrErr && users) {
        users.forEach(u => {
          const contactId = u.id || u.email;
          if (contactId && !seenIds.has(contactId) && !seenIds.has(u.email)) {
            seenIds.add(contactId);
            if (u.id) seenIds.add(u.id);
            if (u.email) seenIds.add(u.email);
            contacts.push({
              id: contactId,
              name: u.name || (u.email ? u.email.split('@')[0] : 'User'),
              avatar: u.avatar || '',
              title: u.role === 'freelancer' ? 'Freelancer Specialist' : 'Client / User',
              email: u.email
            });
          }
        });
      }

      if (contacts.length > 0) return contacts;
    }
  } catch (err) {
    console.warn('[Messaging DB] Could not fetch contacts from Supabase:', err.message);
  }

  // Fallback platform contacts
  return [
    {
      id: 'support-team',
      name: 'SocialFlow Support & Concierge',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=SocialFlow',
      title: 'Platform Support & Order Assistance'
    },
    {
      id: 'theblack2205@gmail.com',
      name: 'Freelance Specialist',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=theblack2205',
      title: 'Freelance Partner (theblack2205@gmail.com)'
    },
    {
      id: 'creative-specialist-1',
      name: 'Elena Rostova',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80',
      title: 'Senior Short-Form Video & Visual Editor'
    }
  ];
}

// ─── Conversations ───────────────────────────────────────────

/**
 * Get all conversations for a user
 */
export async function getConversationsForUser(userId) {
  const aliases = await resolveUserAliases(userId);
  let supabaseConvs = [];

  try {
    if (supabase && aliases.length > 0) {
      const orConditions = aliases.flatMap(id => [
        `participant_1_id.eq.${id}`,
        `participant_2_id.eq.${id}`
      ]).join(',');

      const { data, error } = await withTimeout(
        supabase
          .from('conversations')
          .select('*')
          .or(orConditions)
          .order('last_message_at', { ascending: false }),
        2000
      );

      if (!error && data) {
        supabaseConvs = data;
      }
    }
  } catch (err) {
    console.warn('[Messaging DB] Supabase conversation query fallback:', err.message);
  }

  // Filter memory store conversations matching any alias
  const memoryConvs = memoryStore.conversations.filter(c =>
    aliases.includes(String(c.participant_1_id)) || aliases.includes(String(c.participant_2_id))
  );

  // Combine & deduplicate by conversation id
  const map = new Map();
  for (const c of [...supabaseConvs, ...memoryConvs]) {
    if (!map.has(c.id)) {
      map.set(c.id, c);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

/**
 * Find an existing conversation between two specific users
 */
export async function findConversation(userId1, userId2) {
  const aliases1 = await resolveUserAliases(userId1);
  const aliases2 = await resolveUserAliases(userId2);

  try {
    if (supabase) {
      const conditions = [];
      for (const a1 of aliases1) {
        for (const a2 of aliases2) {
          conditions.push(`and(participant_1_id.eq.${a1},participant_2_id.eq.${a2})`);
          conditions.push(`and(participant_1_id.eq.${a2},participant_2_id.eq.${a1})`);
        }
      }

      if (conditions.length > 0) {
        const { data, error } = await withTimeout(
          supabase
            .from('conversations')
            .select('*')
            .or(conditions.join(','))
            .limit(1)
            .maybeSingle(),
          2000
        );

        if (!error && data) return data;
      }
    }
  } catch (err) {
    console.warn('[Messaging DB] Find conversation fallback:', err.message);
  }

  return memoryStore.conversations.find(c =>
    (aliases1.includes(String(c.participant_1_id)) && aliases2.includes(String(c.participant_2_id))) ||
    (aliases1.includes(String(c.participant_2_id)) && aliases2.includes(String(c.participant_1_id)))
  ) || null;
}

/**
 * Create a new conversation between two users
 */
export async function createConversation({ participant1, participant2, jobId }) {
  const p1Id = String(participant1.id);
  const p1Name = participant1.name || 'User';
  const p1Avatar = participant1.avatar || '';

  const p2Id = String(participant2.id);
  const p2Name = participant2.name || 'User';
  const p2Avatar = participant2.avatar || '';

  const newConv = {
    id: `conv_${Date.now()}`,
    participant_1_id: p1Id,
    participant_1_name: p1Name,
    participant_1_avatar: p1Avatar,
    participant_2_id: p2Id,
    participant_2_name: p2Name,
    participant_2_avatar: p2Avatar,
    job_id: isUuid(jobId) ? jobId : null,
    last_message_text: 'Started conversation',
    last_message_at: new Date().toISOString(),
    unread_count_1: 0,
    unread_count_2: 0,
    created_at: new Date().toISOString()
  };

  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('conversations')
          .insert({
            participant_1_id: p1Id,
            participant_1_name: p1Name,
            participant_1_avatar: p1Avatar,
            participant_2_id: p2Id,
            participant_2_name: p2Name,
            participant_2_avatar: p2Avatar,
            job_id: isUuid(jobId) ? jobId : null,
            last_message_text: 'Started conversation',
            last_message_at: new Date().toISOString(),
            unread_count_1: 0,
            unread_count_2: 0
          })
          .select()
          .single(),
        2000
      );

      if (!error && data) {
        memoryStore.conversations.unshift(data);
        return data;
      }
      if (error) console.warn('[Messaging DB] Supabase create conversation error:', error.message);
    }
  } catch (err) {
    console.warn('[Messaging DB] Create conversation fallback:', err.message);
  }

  memoryStore.conversations.unshift(newConv);
  return newConv;
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(conversationId) {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('conversations')
          .select('*')
          .eq('id', conversationId)
          .maybeSingle(),
        1500
      );

      if (!error && data) return data;
    }
  } catch (err) {
    console.warn('[Messaging DB] Get conversation by ID fallback:', err.message);
  }

  return memoryStore.conversations.find(c => c.id === conversationId) || null;
}

// ─── Messages ────────────────────────────────────────────────

/**
 * Get all messages for a conversation, ordered chronologically
 */
export async function getMessages(conversationId) {
  let supabaseMsgs = [];
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
        2000
      );

      if (!error && data) supabaseMsgs = data;
    }
  } catch (err) {
    console.warn('[Messaging DB] Get messages fallback:', err.message);
  }

  const memMsgs = memoryStore.messages.filter(m => m.conversation_id === conversationId);
  const map = new Map();
  for (const m of [...supabaseMsgs, ...memMsgs]) {
    if (!map.has(m.id)) {
      map.set(m.id, m);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Send a message with optional file attachment
 */
export async function sendMessage({
  conversationId,
  senderId,
  senderName,
  senderAvatar,
  content,
  attachmentUrl = null,
  fileName = null,
  fileType = null,
  fileSize = null,
  mimeType = null,
  storagePath = null
}) {
  const newMsg = {
    id: `msg_${Date.now()}`,
    conversation_id: conversationId,
    sender_id: String(senderId),
    sender_name: senderName || '',
    sender_avatar: senderAvatar || '',
    content: content || (fileName ? `Attachment: ${fileName}` : ''),
    attachment_url: attachmentUrl,
    file_name: fileName,
    file_type: fileType,
    file_size: fileSize,
    mime_type: mimeType,
    storage_path: storagePath,
    is_read: false,
    created_at: new Date().toISOString()
  };

  // Update memory fallback
  memoryStore.messages.push(newMsg);
  const convIndex = memoryStore.conversations.findIndex(c => c.id === conversationId);
  if (convIndex >= 0) {
    const conv = memoryStore.conversations[convIndex];
    const isParticipant1 = String(conv.participant_1_id) === String(senderId);
    conv.last_message_text = (content || fileName || 'Attachment').substring(0, 200);
    conv.last_message_at = newMsg.created_at;
    if (isParticipant1) {
      conv.unread_count_2 = (conv.unread_count_2 || 0) + 1;
    } else {
      conv.unread_count_1 = (conv.unread_count_1 || 0) + 1;
    }
  }

  try {
    if (supabase) {
      const { data: message, error: msgError } = await withTimeout(
        supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: String(senderId),
            sender_name: senderName || '',
            sender_avatar: senderAvatar || '',
            content: content || (fileName ? `Attachment: ${fileName}` : ''),
            attachment_url: attachmentUrl,
            file_name: fileName,
            file_type: fileType,
            file_size: fileSize,
            mime_type: mimeType,
            storage_path: storagePath,
            is_read: false
          })
          .select()
          .single(),
        2000
      );

      if (!msgError && message) {
        const conversation = await getConversationById(conversationId);
        if (conversation) {
          const senderAliases = await resolveUserAliases(senderId);
          const isParticipant1 = senderAliases.includes(String(conversation.participant_1_id));
          const unreadField = isParticipant1 ? 'unread_count_2' : 'unread_count_1';
          const currentUnread = isParticipant1 ? conversation.unread_count_2 : conversation.unread_count_1;

          const previewText = content 
            ? content.substring(0, 150)
            : fileName 
            ? `📁 ${fileName}` 
            : 'Attachment';

          await withTimeout(
            supabase
              .from('conversations')
              .update({
                last_message_text: previewText,
                last_message_at: new Date().toISOString(),
                [unreadField]: (currentUnread || 0) + 1
              })
              .eq('id', conversationId),
            1500
          ).catch(() => {});
        }
        return message;
      }
    }
  } catch (err) {
    console.warn('[Messaging DB] Send message Supabase fallback:', err.message);
  }

  return newMsg;
}

/**
 * Mark all messages in a conversation as read for a user
 */
export async function markMessagesAsRead(conversationId, userId) {
  const userAliases = await resolveUserAliases(userId);

  memoryStore.messages.forEach(m => {
    if (m.conversation_id === conversationId && !userAliases.includes(String(m.sender_id))) {
      m.is_read = true;
    }
  });

  const conv = memoryStore.conversations.find(c => c.id === conversationId);
  if (conv) {
    if (userAliases.includes(String(conv.participant_1_id))) {
      conv.unread_count_1 = 0;
    } else {
      conv.unread_count_2 = 0;
    }
  }

  try {
    if (supabase) {
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .eq('is_read', false)
        .catch(() => {});

      const conversation = await getConversationById(conversationId);
      if (conversation) {
        const isParticipant1 = userAliases.includes(String(conversation.participant_1_id));
        const unreadField = isParticipant1 ? 'unread_count_1' : 'unread_count_2';

        await supabase
          .from('conversations')
          .update({ [unreadField]: 0 })
          .eq('id', conversationId)
          .catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Messaging DB] Mark read fallback:', err.message);
  }
}

/**
 * Get total unread message count across all conversations for a user
 */
export async function getTotalUnreadCount(userId) {
  const userAliases = await resolveUserAliases(userId);
  const conversations = await getConversationsForUser(userId);
  let total = 0;
  for (const conv of conversations) {
    if (userAliases.includes(String(conv.participant_1_id))) {
      total += conv.unread_count_1 || 0;
    } else {
      total += conv.unread_count_2 || 0;
    }
  }
  return total;
}
