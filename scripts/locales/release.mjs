// 飞书通知使用同一份双语资源；缺少或无效语言时回退英文。
export const catalogs = {
  en: {
    titleSuccess: 'ReadmeX · {{platform}} build successful', titleFailure: 'ReadmeX · {{platform}} build failed', titleCancelled: 'ReadmeX · {{platform}} build cancelled',
    platform: 'Platform', version: 'Version', build: 'Build number', source: 'Source', ipa: 'IPA artifact', logs: 'Actions logs', testflight: 'TestFlight',
    uploaded: 'Upload accepted by Apple', failed: 'Upload failed', skipped: 'Not requested', blocked: 'Not uploaded',
    processing: 'Apple processing', pending: 'Pending', valid: 'Ready', invalid: 'Invalid', connectivity: 'ReadmeX · webhook connection verified',
    aab: 'AAB artifact', apk: 'APK artifact', play: 'Google Play', playUploaded: 'Uploaded to Google Play', r2: 'R2 distribution', r2Uploaded: 'Published', download: 'APK download', latest: 'Latest APK', pageSize: '16 KB check', checked: 'Passed',
  },
  zh: {
    titleSuccess: 'ReadmeX · {{platform}} 打包成功', titleFailure: 'ReadmeX · {{platform}} 打包失败', titleCancelled: 'ReadmeX · {{platform}} 打包已取消',
    platform: '平台', version: '版本', build: '构建号', source: '源码', ipa: 'IPA 产物', logs: 'Actions 日志', testflight: 'TestFlight',
    uploaded: 'Apple 已接受上传', failed: '上传失败', skipped: '未请求上传', blocked: '未上传',
    processing: 'Apple 处理状态', pending: '等待处理', valid: '可测试', invalid: '无效', connectivity: 'ReadmeX · Webhook 连通验证成功',
    aab: 'AAB 产物', apk: 'APK 产物', play: 'Google Play', playUploaded: '已上传 Google Play', r2: 'R2 分发', r2Uploaded: '已发布', download: 'APK 下载', latest: '最新 APK', pageSize: '16 KB 检查', checked: '通过',
  },
};

export function releaseCopy(lang) { return catalogs[lang] ?? catalogs.en; }
