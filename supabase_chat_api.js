import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Supabase Configuration
const SUPABASE_URL = "https://llzlvdpuiljmlqoycjgi.supabase.co";
const SUPABASE_KEY = "sb_publishable_vLAJBWKTE8LgYeXZpx5bkA_RJEToyxE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * CHAT API SERVICE
 * Focus: Pure backend logic for Supabase Private Chat
 */

const CHAT_ID = "A_S";

/* ==========================================
   1. MESSAGING FUNCTIONS
   ========================================== */

/**
 * Send a text message
 * @param {string} sender - "A" or "S"
 * @param {string} receiver - "S" or "A"
 * @param {string} text - Message content
 */
export async function sendTextMessage(sender, receiver, text) {
    const { data, error } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender: sender,
            receiver: receiver,
            type: 'text',
            content: text,
            seen: false
        }]);
    if (error) throw error;
    return data;
}

/**
 * Upload media and send message
 * @param {string} sender - "A" or "S"
 * @param {string} receiver - "S" or "A"
 * @param {File|Blob} file - The file to upload
 * @param {string} type - "voice", "image", or "video"
 */
export async function sendMediaMessage(sender, receiver, file, type) {
    // Map to plural bucket names and follow user's naming convention
    let bucket = '';
    let fileName = '';

    if (type === 'voice') {
        bucket = 'voices';
        fileName = Date.now() + ".webm";
    } else if (type === 'image') {
        bucket = 'images';
        fileName = Date.now() + "-" + file.name;
    } else if (type === 'video') {
        bucket = 'videos';
        fileName = Date.now() + "-" + file.name;
    }

    // 1. Upload to Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file);

    if (uploadError) throw uploadError;

    // 2. Get Public URL
    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

    // 3. Save to Database
    const { data, error } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender: sender,
            receiver: receiver,
            type: type,
            content: publicUrl,
            seen: false
        }]);

    if (error) throw error;
    return data;
}

/**
 * Load message history
 */
export async function getMessageHistory() {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', CHAT_ID)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
}

/* ==========================================
   2. STATUS & PRESENCE
   ========================================== */

/**
 * Update user online/offline status
 * @param {string} username - "A" or "S"
 * @param {boolean} isOnline
 */
export async function setUserPresence(username, isOnline) {
    const { error } = await supabase
        .from('users')
        .upsert({
            name: username,
            online: isOnline,
            last_seen: new Date().toISOString()
        });
    if (error) throw error;
}

/**
 * Mark all messages received by user as seen
 * @param {string} receiverName - Name of the user marking messages as seen
 */
export async function markAsSeen(receiverName) {
    const { error } = await supabase
        .from('messages')
        .update({ seen: true })
        .eq('receiver', receiverName)
        .eq('seen', false);
    if (error) throw error;
}

/* ==========================================
   3. REAL-TIME SUBSCRIPTIONS
   ========================================== */

/**
 * Subscribe to message updates
 * @param {Function} onNewMessage - Callback for new messages
 * @param {Function} onMessageUpdate - Callback for modified messages (e.g. seen status)
 */
export function subscribeToMessages(onNewMessage, onMessageUpdate) {
    return supabase.channel('chat_messages')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${CHAT_ID}` },
            payload => onNewMessage(payload.new)
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${CHAT_ID}` },
            payload => onMessageUpdate(payload.new)
        )
        .subscribe();
}

/**
 * Subscribe to user presence updates (online/offline)
 * @param {string} targetUser - User to watch (A or S)
 * @param {Function} onStatusChange - Callback with user data
 */
export function subscribeToPresence(targetUser, onStatusChange) {
    return supabase.channel('user_presence')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'users', filter: `name=eq.${targetUser}` },
            payload => onStatusChange(payload.new)
        )
        .subscribe();
}
