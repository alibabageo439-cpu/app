import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// 1. DATABASE CONFIGURATION
const SUPABASE_URL = "https://llzlvdpuiljmlqoycjgi.supabase.co";
const SUPABASE_KEY = "sb_publishable_vLAJBWKTE8LgYeXZpx5bkA_RJEToyxE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CHAT_ID = "A_S";

/**
 * PRIVATE CHAT BACKEND SERVICE
 * Pure JS functions for Supabase Integration
 */

/* ==========================================
   MESSAGING FUNCTIONS
   ========================================== */

/**
 * Sends a text message to the database
 */
export async function sendTextMessage(sender, receiver, content) {
    const { data, error } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender: sender,
            receiver: receiver,
            type: 'text',
            content: content,
            seen: false
        }]);

    if (error) throw error;
    return data;
}

/**
 * Uploads media to public buckets and saves URL to messages
 * @param {string} type - 'voice', 'image', or 'video'
 * @param {File|Blob} file - The file data
 */
export async function sendMediaMessage(sender, receiver, file, type) {
    let bucket = '';
    let fileName = '';

    // Correct bucket names and naming convention
    if (type === 'voice') {
        bucket = 'voices';
        fileName = `${Date.now()}.webm`;
    } else if (type === 'image') {
        bucket = 'images';
        fileName = `${Date.now()}-${file.name || 'image.png'}`;
    } else if (type === 'video') {
        bucket = 'videos';
        fileName = `${Date.now()}-${file.name || 'video.mp4'}`;
    }

    // 1. Upload to Storage (Using contentType to help with RLS/mime detection)
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });

    if (uploadError) throw uploadError;

    // 2. Get Public URL
    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

    // 3. Save to Messages Table
    const { data, error: dbError } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender: sender,
            receiver: receiver,
            type: type,
            content: publicUrl,
            seen: false
        }]);

    if (dbError) throw dbError;
    return data;
}

/**
 * Fetches all previous messages for the chat
 */
export async function fetchMessages() {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', CHAT_ID)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
}

/* ==========================================
   PRESENCE & STATUS FUNCTIONS
   ========================================== */

/**
 * Updates user online status and last seen
 */
export async function updateUserStatus(username, online) {
    const { error } = await supabase
        .from('users')
        .upsert({
            name: username,
            online: online,
            last_seen: new Date().toISOString()
        }, { onConflict: 'name' });

    if (error) console.error("Status update error:", error);
}

/**
 * Updates all received messages to 'seen' status
 */
export async function markMessagesAsSeen(myUsername) {
    const { error } = await supabase
        .from('messages')
        .update({ seen: true })
        .eq('receiver', myUsername)
        .eq('seen', false);

    if (error) console.error("Mark seen error:", error);
}

/* ==========================================
   REAL-TIME SUBSCRIPTIONS
   ========================================== */

/**
 * Subscribe to new messages and changes
 */
export function subscribeMessages(onInsert, onUpdate) {
    return supabase.channel('chat-room')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if (payload.new.chat_id === CHAT_ID) onInsert(payload.new);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
            if (payload.new.chat_id === CHAT_ID) onUpdate(payload.new);
        })
        .subscribe();
}

/**
 * Subscribe to target user's online status
 */
export function subscribePresence(targetUser, onStatusChange) {
    return supabase.channel('presence-room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `name=eq.${targetUser}` }, payload => {
            onStatusChange(payload.new);
        })
        .subscribe();
}
