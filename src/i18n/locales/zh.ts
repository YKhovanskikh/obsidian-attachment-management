import { TranslationMap } from "../index";

export const zhCn: TranslationMap = {
  // 通用
  common: {
    save: "保存",
    cancel: "取消",
    delete: "删除",
    edit: "编辑",
    add: "添加",
    remove: "移除",
    confirm: "确认",
    close: "关闭"
  },

  // 设置页面
  settings: {
    title: "附件管理设置",
    language: {
      name: "语言",
      desc: "选择界面语言"
    },
    rootPath: {
      name: "附件保存根路径",
      desc: "选择附件的根路径",
      options: {
        obsidian: "复制 Obsidian 设置",
        inFolder: "在下方指定的文件夹中",
        nextToNote: "在笔记旁边的指定文件夹中"
      }
    },
    rootFolder: {
      name: "根文件夹",
      desc: "新附件的根文件夹"
    },
    attachmentPath: {
      name: "附件路径",
      desc: "附件在根文件夹中的路径，可用变量 {{notepath}}、{{notename}}、{{parent}}"
    },
    attachmentFormat: {
      name: "附件格式",
      desc: "定义如何命名附件文件，可用变量 {{dates}}、{{notename}}、{{md5}} 和 {{originalname}}。"
    },
    dateFormat: {
      name: "日期格式",
      desc: "使用的 Moment 日期格式",
      linkText: "Moment 格式选项"
    },
    autoRename: {
      name: "自动重命名附件",
      desc: "当您重命名对应 md/canvas 文件所在的文件夹/文件名时，自动重命名附件文件夹/文件名。"
    },
    deduplicateSha256MaxSize: {
      name: "SHA-256 比较大小限制（MB）",
      desc: "当文件 MD5 和大小一致时，仅在不超过该大小时继续比较 SHA-256。填 0 表示不限制。"
    },
    extensionOverride: {
      name: "扩展名覆盖",
      desc: "如果您想要对特定扩展名的附件进行自动重命名（例如 pdf 或 zip），请使用扩展名覆盖。",
      addButton: "添加扩展名覆盖",
      extension: {
        name: "扩展名",
        desc: "要覆盖的扩展名",
        placeholder: "pdf|docx?"
      },
      tooltips: {
        remove: "移除扩展名覆盖",
        edit: "编辑扩展名覆盖",
        save: "保存扩展名覆盖"
      },
      saved: "已保存扩展名覆盖"
    },
    excludeExtension: {
      name: "排除扩展名模式",
      desc: "用于排除某些扩展名不被处理的正则表达式模式。",
      placeholder: "pdf|docx?|xlsx?|pptx?|zip|rar"
    },
    excludedPaths: {
      name: "排除路径",
      desc: "提供要从重命名中排除的文件夹名称的完整路径（区分大小写且不带前导斜杠 \"/\"），用分号（;）分隔。"
    },
    excludeSubpaths: {
      name: "排除子路径",
      desc: "如果您还想排除上面提供的文件夹路径的所有子文件夹，请打开此选项。"
    }
  },

  // 覆盖设置模态框
  override: {
    title: "覆盖设置",
    menuTitle: "覆盖附件设置",
    addExtensionOverrides: "添加扩展名覆盖",
    extension: {
      name: "扩展名",
      desc: "要覆盖的扩展名",
      placeholder: "pdf"
    },
    buttons: {
      reset: "重置",
      submit: "提交"
    }
  },

  // 扩展覆盖模态框
  extensionOverride: {
    title: "扩展名覆盖设置",
    extension: {
      name: "扩展名",
      desc: "要覆盖的扩展名模式（例如：pdf、docx、jpg）",
      placeholder: "pdf|docx?"
    },
    rootPath: {
      name: "附件保存根路径",
      desc: "选择此扩展名的附件根路径"
    },
    rootFolder: {
      name: "根文件夹",
      desc: "此扩展名的根文件夹"
    },
    attachmentPath: {
      name: "附件路径",
      desc: "此扩展名在根文件夹中的附件路径"
    },
    attachmentFormat: {
      name: "附件格式",
      desc: "定义此扩展名的附件文件命名方式"
    },
    buttons: {
      save: "保存"
    },
    notice: {
      extensionEmpty: "扩展名不能为空",
      extensionExists: "扩展名已存在",
      saved: "扩展名覆盖保存成功"
    }
  },

  // 确认对话框
  confirm: {
    title: "提示",
    message: "此操作不可逆且为实验性功能，请先备份您的库！",
    continue: "继续",
    deleteOverride: "您确定要删除此覆盖设置吗？",
    deleteExtensionOverride: "您确定要删除此扩展名覆盖吗？"
  },

  // 命令
  commands: {
    rearrangeActiveFile: "重新整理当前文件的附件",
    rearrangeAllFiles: "重新整理所有文件的附件",
    openSettings: "打开附件管理设置",
    overrideAttachmentSetting: "覆盖附件设置",
    rearrangeAllLinks: "重新整理所有链接的附件",
    rearrangeActiveLinks: "重新整理链接的附件",
    resetOverrideSetting: "重置覆盖设置",
    clearUnusedStorage: "清理未使用的原始名称存储"
  },

  // 通知消息
  notifications: {
    arrangeCompleted: "整理完成",
    fileExcluded: "{path} 已被排除",
    fileExcludedSkipped: "{path} 已被排除，已跳过",
    fileExcludedFromManagement: "{path} 已从附件管理中排除",
    resetAttachmentSetting: "已重置 {path} 的附件设置",
    overrideRemoved: "已移除 {path} 的覆盖设置",
    overrideReset: "已重置 {path} 的附件设置",
    overrideApplied: "已覆盖 {path} 的附件设置",
    attachmentRenamed: "已将 {from} 重命名为 {to}。",
    extensionOverrideSaved: "扩展名覆盖保存成功",
    validation: {
      canvasNotSupported: "不支持将 Canvas 作为扩展覆盖。",
      markdownNotSupported: "不支持将 Markdown 作为扩展覆盖。",
      extensionEmpty: "扩展覆盖不能为空。",
      duplicateExtension: "重复的扩展覆盖。",
      excludedExtension: "扩展覆盖不能是被排除的扩展。"
    }
  },

  // 错误消息
  errors: {
    canvasNotSupported: "不支持将 Canvas 作为扩展覆盖。",
    markdownNotSupported: "不支持将 Markdown 作为扩展覆盖。",
    extensionEmpty: "扩展覆盖不能为空。",
    duplicateExtension: "重复的扩展覆盖。",
    excludedExtension: "扩展覆盖不能是被排除的扩展。"
  }
};
