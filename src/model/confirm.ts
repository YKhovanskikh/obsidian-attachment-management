import { Modal, Notice, Setting } from "obsidian";
import AttachmentManagementPlugin from "../main";
import { ArrangeHandler, RearrangeType, formatArrangeCompletedMessage } from "../arrange";
import { t } from "../i18n/index";

export class ConfirmModal extends Modal {
  plugin: AttachmentManagementPlugin;

  constructor(plugin: AttachmentManagementPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", {
      text: t("confirm.title"),
    });
    contentEl.createSpan("", (el) => {
      el.innerText = t("confirm.message");
    });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText(t("common.cancel"))
          .setCta()
          .onClick(() => {
            this.close();
          });
      })
      .addButton((btn) =>
        btn.setButtonText(t("confirm.continue")).onClick(async () => {
          try {
            const stats = await new ArrangeHandler(this.plugin.settings, this.plugin.app, this.plugin).rearrangeAttachment(
              RearrangeType.LINKS
            );
            new Notice(formatArrangeCompletedMessage(stats), 8000);
          } finally {
            this.close();
          }
        })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
