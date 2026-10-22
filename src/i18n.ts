export type Locale = "zh-CN" | "en";

const en = {
  settings_title: "Customize Pet",
  settings_intro: "Create a desktop pet from a still image or transparent GIF on this Mac.",
  import_heading: "1. Choose images",
  style_label: "Pet style",
  style_single: "One image for every state",
  style_states: "Different images for each state",
  single_hint: "Single image mode saves only the default image. Switching modes keeps your draft.",
  states_hint: "States without their own image use the default. Single image mode saves only the default.",
  default_asset: "Default image (required, PNG, JPEG or transparent GIF, up to 10 MiB)",
  optional_asset: "Optional image",
  upload_image: "Choose an image or transparent GIF",
  processing_mode: "Processing mode",
  remove_background: "Remove background automatically (macOS 14+)",
  keep_alpha: "Keep transparent PNG",
  keep_animation: "Keep transparent GIF animation",
  original: "Original image",
  original_alt: "Original image preview",
  processed: "Pet preview (actual window size)",
  processed_alt: "Transparent pet preview",
  select_image: "Choose an image",
  select_default: "Choose a default image",
  processing: "Processing image…",
  processing_short: "Processing…",
  preview_ready: "Preview ready. Adjust and save your pet.",
  preview_ready_short: "Preview ready",
  fallback_default: "Uses the default image",
  slot_set: "Image set",
  slot_fallback: "Uses default",
  slot_required: "Required",
  file_selected: "Selected: {name}",
  remove_slot: "Remove state image",
  adjust_heading: "2. Adjust and save",
  name: "Name",
  name_placeholder: "Name your pet",
  scale: "Size",
  motion_label: "Motion effect",
  motion_follow_state: "Follow work state",
  motion_still: "Still",
  motion_sway: "Sway side to side",
  motion_float: "Float up and down",
  motion_breathe: "Breathe",
  motion_bounce: "Bounce",
  motion_wobble: "Gentle wobble",
  motion_gif_hint: "GIFs keep their own frame animation.",
  motion_upload_hint: "Choose a still image to select a motion effect.",
  offset_x: "Horizontal offset",
  offset_y: "Vertical offset",
  state_preview: "State preview",
  save_use: "Save and use",
  saved_success: "Pet saved and selected.",
  selected_success: "Pet selected.",
  deleted_success: "Pet deleted.",
  saved_heading: "My pets",
  builtin_cat: "Default pixel cat",
  delete: "Delete",
  delete_named: "Delete {name}",
  mode_unsupported: "This image import mode is unavailable on this system.",
  mac_only: "Image import is currently available on macOS only.",
  invalid_saved_slots: "The {slots} image in this pet is unavailable. The default image is in use. Please recreate this pet.",
  state_default: "Default / Rest",
  state_working: "Working",
  state_waiting: "Waiting",
  state_error: "Error",
  state_completed: "Completed",
  state_unknown: "Unknown",
  waiting_help: "Waiting appears when Claude Code or Codex asks for approval or input. Other work may go straight from Working to Completed.",
  too_large: "Image exceeds the 10 MiB or 4096-pixel limit.",
  profile_too_large: "All pet images together exceed 25 MiB.",
  unsupported_format: "Choose a PNG, JPEG or transparent GIF image.",
  gif_requires_animation: "Choose Keep transparent GIF animation for a GIF.",
  animation_requires_gif: "Keep animation requires a transparent GIF.",
  alpha_requires_png: "Keep transparent background requires a PNG image.",
  invalid_animation: "Choose a transparent GIF with 2–120 frames.",
  no_transparency: "Choose an image with a transparent background.",
  no_subject: "No visible subject was found.",
  invalid_image: "This image could not be read or used.",
  invalid_preview: "The image preview is invalid.",
  mime_mismatch: "The image type does not match its contents.",
  default_required: "Create a preview for the default image first.",
  wait_processing: "Wait for image processing to finish.",
  invalid_transform: "Size must be between 0.5 and 3.",
  invalid_motion: "This motion effect does not match the selected image.",
  invalid_transform_hint: "Enter a size between 0.5 and 3.",
  invalid_name: "Pet name must contain 1–64 characters.",
  invalid_id: "Invalid pet ID.",
  invalid_manifest: "Pet settings are invalid.",
  not_found: "Pet was not found.",
  cannot_delete_builtin: "The built-in cat cannot be deleted.",
  unsupported_platform: "This feature is unavailable on this system.",
  internal_error: "Operation failed",
} as const;

const zh: Record<keyof typeof en, string> = {
  settings_title: "自定义桌宠", settings_intro: "在本机用静态图片或透明 GIF 制作桌宠。",
  import_heading: "1. 导入图片", style_label: "制作方式", style_single: "单图：所有状态共用一张", style_states: "按状态：为不同状态设置素材",
  single_hint: "单图模式只保存默认素材。切换模式会保留当前草稿。", states_hint: "未设置专属素材的状态会使用默认素材。切回单图时只保存默认素材。",
  default_asset: "默认素材（必选，PNG、JPEG 或透明 GIF，最大 10 MiB）", optional_asset: "可选素材", upload_image: "上传图片或透明 GIF",
  processing_mode: "处理方式", remove_background: "自动去背景（macOS 14+）", keep_alpha: "保留透明 PNG", keep_animation: "保留透明 GIF 动画",
  original: "原图", original_alt: "原图预览", processed: "桌宠预览（实际窗口尺寸）", processed_alt: "透明桌宠预览",
  select_image: "请选择图片", select_default: "请选择默认素材", processing: "正在处理图片…", processing_short: "正在处理…",
  preview_ready: "预览已生成，可调整并保存", preview_ready_short: "预览已生成", fallback_default: "未设置，使用默认素材", slot_set: "已设置", slot_fallback: "使用默认", slot_required: "必选", file_selected: "已选择：{name}", remove_slot: "移除该状态素材",
  adjust_heading: "2. 调整并保存", name: "名称", name_placeholder: "给桌宠起个名字", scale: "大小", offset_x: "水平偏移", offset_y: "垂直偏移",
  motion_label: "动态特效", motion_follow_state: "跟随工作状态", motion_still: "静止", motion_sway: "左右摇摆", motion_float: "上下浮动", motion_breathe: "呼吸", motion_bounce: "弹跳", motion_wobble: "轻晃",
  motion_gif_hint: "GIF 保留原有逐帧动画。", motion_upload_hint: "选择静态图片后可设置动效。",
  state_preview: "状态预览", save_use: "保存并使用", saved_success: "桌宠已保存并使用。", selected_success: "已切换桌宠。", deleted_success: "桌宠已删除。", saved_heading: "我的桌宠", builtin_cat: "默认像素猫", delete: "删除", delete_named: "删除 {name}",
  mode_unsupported: "当前系统不支持这种图片导入", mac_only: "图片导入当前仅支持 macOS", invalid_saved_slots: "当前桌宠的{slots}素材不可用，已使用默认素材。请重新创建桌宠。",
  state_default: "默认／休息", state_working: "工作", state_waiting: "等待", state_error: "出错", state_completed: "完成", state_unknown: "未知",
  waiting_help: "等待表示 Claude Code 或 Codex 正在请求确认或输入；其他工作可能从工作直接进入完成。",
  too_large: "图片不能超过 10 MiB 或 4096 像素。", profile_too_large: "桌宠全部素材不能超过 25 MiB。", unsupported_format: "请选择 PNG、JPEG 或透明 GIF 图片。",
  gif_requires_animation: "GIF 仅支持保留透明动图。", animation_requires_gif: "保留动图需要透明 GIF。", alpha_requires_png: "保留透明背景需要 PNG 图片。",
  invalid_animation: "请选择有 2–120 帧的透明 GIF。", no_transparency: "请选择透明背景图片。", no_subject: "没有找到可见主体。", invalid_image: "无法读取或使用这张图片。",
  invalid_preview: "图片预览无效。", mime_mismatch: "图片格式与内容不符。", default_required: "请先生成默认素材预览。", wait_processing: "请等待图片处理完成。",
  invalid_transform: "大小须在 0.5 到 3 之间。", invalid_motion: "动效与所选图片不匹配。", invalid_transform_hint: "请输入 0.5 到 3 之间的大小。", invalid_name: "桌宠名称应为 1–64 个字符。",
  invalid_id: "桌宠 ID 无效。", invalid_manifest: "桌宠设置无效。", not_found: "找不到桌宠。", cannot_delete_builtin: "不能删除默认像素猫。",
  unsupported_platform: "当前系统不支持此功能。", internal_error: "操作失败",
};

export const dictionaries = { en, "zh-CN": zh };
export type UiKey = keyof typeof en;

export function t(locale: Locale, key: UiKey, params: Record<string, string | number> = {}): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}

export interface PetError { code: string; detail?: string }
export function asPetError(error: unknown): PetError {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return { code: error.code, detail: "detail" in error && typeof error.detail === "string" ? error.detail : undefined };
  }
  return { code: "internal_error", detail: error instanceof Error ? error.message : String(error) };
}

export function formatPetError(locale: Locale, error: unknown): string {
  const { code, detail } = asPetError(error);
  const known = Object.prototype.hasOwnProperty.call(dictionaries.en, code);
  const label = t(locale, known ? code as UiKey : "internal_error");
  return detail ? `${label}: ${detail}` : label;
}
