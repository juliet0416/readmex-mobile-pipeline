// 飞书通知使用同一份双语资源；缺少或无效语言时回退英文。
export const catalogs = {
  en: {
    titleSuccess: 'ReadmeX · {{platform}} build successful', titleFailure: 'ReadmeX · {{platform}} build failed', titleCancelled: 'ReadmeX · {{platform}} build cancelled',
    platform: 'Platform', version: 'Version', build: 'Build number', source: 'Source', ipa: 'IPA artifact', logs: 'Actions logs', testflight: 'TestFlight',
    uploaded: 'Upload accepted by Apple', failed: 'Upload failed', skipped: 'Not requested', blocked: 'Not uploaded',
    processing: 'Apple processing', pending: 'Pending', valid: 'Ready', invalid: 'Invalid', connectivity: 'ReadmeX · webhook connection verified',
    aab: 'AAB artifact (GitHub)', apk: 'APK artifact (GitHub)', play: 'Google Play', playUploaded: 'Uploaded to Google Play', r2: 'R2 distribution', r2Uploaded: 'Published', download: 'APK download (this version)', latest: 'APK download (latest)', pageSize: '16 KB check', checked: 'Passed',
    trackInternal: 'Internal testing', trackAlpha: 'Closed testing (alpha)', trackBeta: 'Open testing (beta)', trackProduction: 'Production', statusDraft: 'Draft', statusCompleted: 'Release to track',
    archive: 'Tag release archive', archived: 'Archived', archiveFailed: 'Archive failed', archiveSkipped: 'Not archived', releaseAab: 'AAB download (Release)', releaseApk: 'APK download (Release)', releaseIpa: 'IPA download (Release)', titleArchiveSuccess: 'ReadmeX · {{platform}} archive successful', titleArchiveFailure: 'ReadmeX · {{platform}} archive failed',
  },
  zh: {
    titleSuccess: 'ReadmeX · {{platform}} 打包成功', titleFailure: 'ReadmeX · {{platform}} 打包失败', titleCancelled: 'ReadmeX · {{platform}} 打包已取消',
    platform: '平台', version: '版本', build: '构建号', source: '源码', ipa: 'IPA 产物', logs: 'Actions 日志', testflight: 'TestFlight',
    uploaded: 'Apple 已接受上传', failed: '上传失败', skipped: '未请求上传', blocked: '未上传',
    processing: 'Apple 处理状态', pending: '等待处理', valid: '可测试', invalid: '无效', connectivity: 'ReadmeX · Webhook 连通验证成功',
    aab: 'AAB 构建产物（GitHub）', apk: 'APK 构建产物（GitHub）', play: 'Google Play', playUploaded: '已上传 Google Play', r2: 'R2 分发', r2Uploaded: '已发布', download: 'APK 下载（本版本）', latest: 'APK 下载（最新版）', pageSize: '16 KB 检查', checked: '通过',
    trackInternal: '内部测试', trackAlpha: '封闭测试（alpha）', trackBeta: '开放测试（beta）', trackProduction: '正式发布', statusDraft: '草稿', statusCompleted: '发布到所选轨道',
    archive: 'Tag 产物归档', archived: '已归档', archiveFailed: '归档失败', archiveSkipped: '未归档', releaseAab: 'AAB 下载（Release）', releaseApk: 'APK 下载（Release）', releaseIpa: 'IPA 下载（Release）', titleArchiveSuccess: 'ReadmeX · {{platform}} 归档成功', titleArchiveFailure: 'ReadmeX · {{platform}} 归档失败',
  },
};

export function releaseCopy(lang) { return catalogs[lang] ?? catalogs.en; }
