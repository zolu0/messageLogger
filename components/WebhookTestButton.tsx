/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { useState } from "@webpack/common";
import { isValidWebhookUrl, lastWebhookError, sendPlainWebhookTest } from "../webhooks";

interface WebhookTestButtonProps {
    webhookUrl: string;
}

export function WebhookTestButton({ webhookUrl }: WebhookTestButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleTestWebhook = async () => {
        setLoading(true);
        try {
            if (!webhookUrl.trim()) {
                alert("Please enter a webhook URL");
                return;
            }

            if (!isValidWebhookUrl(webhookUrl)) {
                alert("Invalid webhook URL. Must be a Discord webhook URL.");
                return;
            }

            const success = await sendPlainWebhookTest(webhookUrl);
            if (success) {
                alert("Test message sent successfully!");
            } else {
                alert(lastWebhookError || "Failed to send test message. Check console for errors.");
            }
        } catch (error) {
            alert(`Error: ${error}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ marginBottom: "10px" }}>
            <Button
                disabled={loading || !webhookUrl.trim()}
                onClick={handleTestWebhook}
            >
                {loading ? "Testing..." : "Test Webhook"}
            </Button>
        </div>
    );
}
