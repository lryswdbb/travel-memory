/* ============ Supabase 配置 ============
 * anon key 是公开密钥，可以安全提交到仓库；数据安全靠数据库 RLS 策略保障。
 */
window.APP_CONFIG = {
  SUPABASE_URL:      'https://tvddwiyzvrsatydtuvsv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2ZGR3aXl6dnJzYXR5ZHR1dnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzgxOTUsImV4cCI6MjEwODM1NDE5NX0.-uAyAWfLyeucKXOSRZiPMorzvajJ_Emy2QrS7E9lsPU',
};
// 构建版本号：每次发布更新时修改。启动时与服务器比对，
// 发现本地跑的是旧缓存版本会提示一键刷新（解决脱机/坏 DNS 吃旧缓存问题）
window.APP_BUILD = '2026-10-25c';
