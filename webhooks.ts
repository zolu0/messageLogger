/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { DBMessageStatus } from "./db";
import { LoggedAttachment, LoggedMessageJSON } from "./types";
import { getNative } from "./utils/misc";

export const WebhookLogger = new Logger("MessageLogger-Webhook", "#7289da");
export let lastWebhookError = "";

const WEBHOOK_SENDER_VERSION = "plain-payload-v1";
console.info(`[MessageLogger-Webhook] Loaded ${WEBHOOK_SENDER_VERSION}`);

export interface WebhookMessage {
    content?: string;
    embeds?: any[];
    username?: string;
    avatar_url?: string;
    allowed_mentions?: {
        parse: string[];
    };
}

const DISCORD_WEBHOOK_CONTENT_LIMIT = 2000;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_FIELD_LIMIT = 1024;
const DISCORD_WEBHOOK_URL_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+(?:\?.*)?$/;
const Native = getNative();

export async function sendPlainWebhookTest(webhookUrl: string): Promise<boolean> {
    if (!webhookUrl || !webhookUrl.trim()) {
        lastWebhookError = "Please enter a webhook URL";
        return false;
    }

    const trimmedWebhookUrl = webhookUrl.trim();

    if (!DISCORD_WEBHOOK_URL_RE.test(trimmedWebhookUrl)) {
        lastWebhookError = "Invalid Discord webhook URL";
        return false;
    }

    try {
        lastWebhookError = "";
        const testMessage = {
            content: "Message Logger webhook test",
            allowed_mentions: {
                parse: [],
            },
        };

        console.info(`[MessageLogger-Webhook] Sending test ${WEBHOOK_SENDER_VERSION}`, testMessage);

        const response = await postWebhook(trimmedWebhookUrl, testMessage);

        if (!response.ok) {
            const errorBody = readWebhookError(response);
            lastWebhookError = `Failed to send webhook test: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`;
            WebhookLogger.error(lastWebhookError);
            console.error("[MessageLogger-Webhook]", lastWebhookError, testMessage);
            return false;
        }

        return true;
    } catch (error) {
        lastWebhookError = `Error sending webhook test: ${String(error)}`;
        WebhookLogger.error("Error sending webhook test:", error);
        console.error("[MessageLogger-Webhook]", error);
        return false;
    }
}

/**
 * Send a logged message to a Discord webhook
 */
export async function sendToWebhook(webhookUrl: string, message: LoggedMessageJSON, status: DBMessageStatus): Promise<boolean> {
    if (!webhookUrl || !webhookUrl.trim()) {
        return false;
    }

    try {
        lastWebhookError = "";
        const webhookMessage = formatMessageForWebhook(message, status);
        console.info(`[MessageLogger-Webhook] Sending ${WEBHOOK_SENDER_VERSION}`, webhookMessage);

        const response = await postWebhook(webhookUrl.trim(), webhookMessage);

        if (!response.ok) {
            const errorBody = readWebhookError(response);

            if (response.status === 400) {
                const fallbackMessage = createFallbackWebhookMessage(message, status);
                const fallbackResponse = await postWebhook(webhookUrl.trim(), fallbackMessage);

                if (fallbackResponse.ok) {
                    const fallbackNote = `Original webhook payload was rejected by Discord: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`;
                    lastWebhookError = fallbackNote;
                    WebhookLogger.log(fallbackNote);
                    console.warn("[MessageLogger-Webhook]", fallbackNote, webhookMessage);
                    return true;
                }

                const fallbackErrorBody = readWebhookError(fallbackResponse);
                lastWebhookError = `Failed to send webhook fallback: ${fallbackResponse.status} ${fallbackResponse.statusText}${fallbackErrorBody ? ` - ${fallbackErrorBody}` : ""}. Original error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`;
                WebhookLogger.error(lastWebhookError);
                console.error("[MessageLogger-Webhook]", lastWebhookError, fallbackMessage);
                return false;
            }

            lastWebhookError = `Failed to send webhook: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`;
            WebhookLogger.error(lastWebhookError);
            console.error("[MessageLogger-Webhook]", lastWebhookError);
            return false;
        }

        return true;
    } catch (error) {
        lastWebhookError = `Error sending to webhook: ${String(error)}`;
        WebhookLogger.error("Error sending to webhook:", error);
        console.error("[MessageLogger-Webhook]", error);
        return false;
    }
}

interface WebhookResponse {
    ok: boolean;
    status: number;
    statusText: string;
    body: string;
}

function postWebhook(webhookUrl: string, payload: WebhookMessage): Promise<WebhookResponse> {
    return Native.sendWebhookNative(webhookUrl, JSON.stringify(payload));
}

/**
 * Format a logged message as a detailed webhook message
 */
function formatMessageForWebhook(message: LoggedMessageJSON, status: DBMessageStatus): WebhookMessage {
    const author = formatAuthorName(message);
    const attachmentLines = formatAttachmentLines(message.attachments ?? []);
    const imageAttachments = (message.attachments ?? [])
        .filter(isImageAttachment)
        .slice(0, 4);

    const fields = [
        {
            name: "Author",
            value: author,
            inline: true,
        },
        {
            name: "Channel",
            value: formatChannelReference(message.channel_id),
            inline: true,
        },
    ];

    if (attachmentLines.length) {
        fields.push({
            name: "Attachments",
            value: truncateEmbedField(attachmentLines.join("\n")),
            inline: false,
        });
    }

    if (status === DBMessageStatus.EDITED && message.editHistory?.length) {
        fields.push({
            name: "Previous edits",
            value: truncateEmbedField(message.editHistory
                .slice(-3)
                .map(edit => `${formatDiscordTimestamp(edit.timestamp, "t")} ${escapeDiscordContent(edit.content ?? "") || "(empty)"}`)
                .join("\n")),
            inline: false,
        });
    }

    const embeds = [
        {
            description: truncateEmbedDescription(escapeDiscordContent(message.content || "(no text content)")),
            color: getStatusColor(status),
            timestamp: getIsoTimestamp(message.timestamp),
            fields,
        },
        ...imageAttachments.map(attachment => ({
            title: attachment.filename ?? "Attachment",
            url: getAttachmentUrl(attachment),
            image: {
                url: getAttachmentUrl(attachment),
            },
            color: getStatusColor(status),
        })),
    ];

    return {
        embeds,
        username: "mmm",
        allowed_mentions: {
            parse: [],
        },
    };
}

function getStatusColor(status: DBMessageStatus): number {
    switch (status) {
        case DBMessageStatus.DELETED:
            return 0xed4245;
        case DBMessageStatus.EDITED:
            return 0xfee75c;
        case DBMessageStatus.GHOST_PINGED:
            return 0xeb459e;
        default:
            return 0x5865f2;
    }
}

function escapeDiscordContent(content: string): string {
    return stripProblematicCharacters(content)
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .slice(0, 1000); // Limit to 1000 chars
}

function truncateDiscordContent(content: string): string {
    content = stripProblematicCharacters(content);

    if (content.length <= DISCORD_WEBHOOK_CONTENT_LIMIT) {
        return content;
    }

    return content.slice(0, DISCORD_WEBHOOK_CONTENT_LIMIT - 3) + "...";
}

function createFallbackWebhookMessage(message: LoggedMessageJSON, status: DBMessageStatus): WebhookMessage {
    const attachmentLines = formatAttachmentLines(message.attachments ?? []);

    return {
        content: truncateDiscordContent([
            `Author: ${formatAuthorName(message)}`,
            `Channel: ${formatChannelReference(message.channel_id)}`,
            message.content ? `Content: ${stripProblematicCharacters(message.content).slice(0, 500)}` : undefined,
            attachmentLines.length ? `Attachments:\n${attachmentLines.join("\n")}` : undefined,
        ].filter(Boolean).join("\n")),
        allowed_mentions: {
            parse: [],
        },
    };
}

function readWebhookError(response: WebhookResponse): string {
    return response.body;
}

function stripProblematicCharacters(content: string): string {
    return content.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function formatAuthorName(message: LoggedMessageJSON): string {
    return message.author?.globalName ||
        (message.author as any)?.global_name ||
        message.author?.username ||
        "Unknown";
}

function formatChannelReference(channelId?: string): string {
    return channelId && /^\d+$/.test(channelId)
        ? `<#${channelId}>`
        : channelId ?? "Unknown";
}

function formatDiscordTimestamp(timestamp?: string, style = "F"): string {
    if (!timestamp) return "Unknown";

    const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);

    return Number.isFinite(unixTimestamp)
        ? `<t:${unixTimestamp}:${style}>`
        : timestamp;
}

function getIsoTimestamp(timestamp?: string): string | undefined {
    if (!timestamp) return undefined;

    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function formatAttachmentLines(attachments: LoggedAttachment[]): string[] {
    return attachments.map(attachment => {
        const name = escapeDiscordContent(attachment.filename ?? "Attachment");
        const size = typeof attachment.size === "number" ? ` (${formatFileSize(attachment.size)})` : "";
        const url = getAttachmentUrl(attachment);

        return url ? `- [${name}](${url})${size}` : `- ${name}${size}`;
    });
}

function getAttachmentUrl(attachment: LoggedAttachment): string | undefined {
    const url = attachment.oldUrl || attachment.oldProxyUrl || attachment.url || attachment.proxy_url;

    return url?.startsWith("http") ? url : undefined;
}

function isImageAttachment(attachment: LoggedAttachment): boolean {
    return Boolean(
        getAttachmentUrl(attachment) &&
        (attachment.content_type?.startsWith("image/") || /\.(?:apng|avif|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(attachment.filename ?? ""))
    );
}

function truncateEmbedDescription(content: string): string {
    return content.length <= DISCORD_EMBED_DESCRIPTION_LIMIT
        ? content
        : content.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT - 3) + "...";
}

function truncateEmbedField(content: string): string {
    return content.length <= DISCORD_EMBED_FIELD_LIMIT
        ? content
        : content.slice(0, DISCORD_EMBED_FIELD_LIMIT - 3) + "...";
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Validate if a webhook URL is valid
 */
export function isValidWebhookUrl(url: string): boolean {
    return DISCORD_WEBHOOK_URL_RE.test(url.trim());
}
