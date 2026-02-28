import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const supabaseUrl = "https://llzlvdpuiljmlqoycjgi.supabase.co";
const supabaseKey = "sb_publishable_vLAJBWKTE8LgYeXZpx5bkA_RJEToyxE";

export const supabase = createClient(supabaseUrl, supabaseKey);
console.log("Supabase Client Initialized ✅");
