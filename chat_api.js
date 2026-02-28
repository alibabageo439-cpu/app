import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// --- 1. CONFIGURATION ---
const URL = "https://llzlvdpuiljmlqoycjgi.supabase.co";
const KEY = "sb_publishable_vLAJBWKTE8LgYeXZpx5bkA_RJEToyxE";
export const supabase = createClient(URL, KEY);

const CHAT_ID = "A_S";

// --- 2. MESSAGING ---

/**
 * Send a Text Message
 */
export async function sendText(sender, receiver, content) {
    const { data, error } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender,
            receiver,
            type: 'text',
            content,
            seen: false
        }]);
    if (error) throw error;
    return data;
}

/**
 * Upload Media & Send Message
 * @param {string} type - 'voice', 'image', or 'video'
 * @param {File|Blob} file - The raw file/blob
 */
export async function sendMedia(sender, receiver, file, type) {
    // Determine bucket and filename based on your requirements
    let bucket = '';
    let fileName = '';

    if (type === 'voice') {
        bucket = 'voices';
        fileName = Date.now() + ".webm";
    } else if (type === 'image') {
        bucket = 'images';
        fileName = Date.now() + "-" + (file.name || "upload.png");
    } else if (type === 'video') {
        bucket = 'videos';
        fileName = Date.now() + "-" + (file.name || "upload.mp4");
    }

    // 1. Upload to Storage
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
        console.error("Storage Error:", uploadError);
        throw new Error("Storage Upload Failed: " + uploadError.message);
    }

    // 2. Get Public URL
    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

    // 3. Save to Messages Table
    const { data, error: dbError } = await supabase
        .from('messages')
        .insert([{
            chat_id: CHAT_ID,
            sender,
            receiver,
            type,
            content: publicUrl,
            seen: false
        }]);

    if (dbError) throw dbError;
    return data;
}

// --- 3. STATUS & PRESENCE ---

/**
 * Update Online Status
 */
export async function updateStatus(username, isOnline) {
    const { error } = await supabase
        .from('users')
        .upsert({
            name: username,
            online: isOnline,
            last_seen: new Date().toISOString()
        });
    if (error) console.error("Presence update failed:", error);
}

/**
 * Mark Messages as Seen
 */
export async function markSeen(myUsername) {
    const { error } = await supabase
        .from('messages')
        .update({ seen: true })
        .eq('receiver', myUsername)
        .eq('seen', false);
    if (error) console.error("Mark seen failed:", error);
}

// --- 4. REAL-TIME SUBSCRIPTIONS ---

/**
 * Subscribe to Live Chat
 */
export function listenToChat(onNewMsg, onUpdate) {
    return supabase.channel('global_chat')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            payload => onNewMsg(payload.new)
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages' },
            payload => onUpdate(payload.new)
        )
        .subscribe();
}

/**
 * Subscribe to User Status
 */
export function listenToStatus(targetUser, onStatusChange) {
    return supabase.channel('user_status')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'users', filter: `name=eq.${targetUser}` },
            payload => onStatusChange(payload.new)
        )
        .subscribe();
}
