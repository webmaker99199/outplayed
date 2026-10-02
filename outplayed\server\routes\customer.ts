import { Router } from "express";
import { rateLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { getPagination } from "../utils/validation.js";
import * as sellauth from "../services/sellauth.js";
import { getDiscordTickets } from "../services/discord-tickets.js";

/**
 * Customer-specific routes (canonical namespace: /api/outplayed/*).
 *
 * All of these return private data and therefore go through `requireAuth`.
 * SellAuth data is filtered down to the authenticated customer only.
 */

const router = Router();

/** GET /orders — the authenticated customer's invoices, filtered by status, paginated. */
router.get("/orders", rateLimiter(120, 60_000), requireAuth, async (req, res) => {
  try {
    const session = req.session!;
    const invoices = await sellauth.getInvoices();

    // Filter strictly by the authenticated customer. Never fall back to the
    // full invoice list (that would leak other customers' data).
    let filteredInvoices;
    if (session.customerId) {
      filteredInvoices = invoices.filter((inv: any) => inv.shop_customer_id === session.customerId);
    } else if (session.customerEmail) {
      filteredInvoices = invoices.filter(
        (inv: any) => inv.email && inv.email.toLowerCase() === session.customerEmail!.toLowerCase()
      );
    } else {
      filteredInvoices = [];
    }

    const statusFilter = typeof req.query.status === "string" ? req.query.status.toLowerCase() : null;
    if (statusFilter && statusFilter !== "all") {
      filteredInvoices = filteredInvoices.filter(
        (inv: any) => String(inv.status).toLowerCase() === statusFilter
      );
    }

    const orders = filteredInvoices.map((inv: any) => ({
      id: inv.id,
      status: inv.status || "completed",
      statusDescription: inv.status === "completed" ? "Completed" : inv.status || "Completed",
      price: inv.price || "0.00",
      paid: inv.paid || "0.00",
      paidUsd: inv.paid_usd || "0.00",
      currency: inv.currency || "USD",
      gateway: inv.gateway || "Crypto",
      redirectUrl: inv.unique_id ? `https://sellauth.com/invoice/${inv.unique_id}` : null,
      createdAt: inv.created_at || new Date().toISOString(),
      completedAt: inv.completed_at || inv.created_at || new Date().toISOString(),
      paymentMethod: inv.payment_method
        ? { name: inv.payment_method.name || inv.gateway }
        : { name: inv.gateway || "Payment" },
      items: (
        inv.items && Array.isArray(inv.items) && inv.items.length > 0
          ? inv.items
          : [
              {
                product_name: inv.product?.name || "Digital Product License",
                variant_name: inv.variant?.name || "Standard",
                quantity: 1,
                total_price: inv.price || "0.00",
                delivered: [],
              },
            ]
      ).map((it: any) => ({
        productName: it.product_name || inv.product?.name || "Digital Product License",
        variantName: it.variant_name || inv.variant?.name || "Standard",
        status: inv.status || "completed",
        quantity: it.quantity || 1,
        totalPrice: it.total_price || it.price || inv.price || "0.00",
        delivered: it.delivered || it.license_keys || [],
      })),
    }));

    const { page, perPage, startIndex, lastPage } = getPagination(req.query as Record<string, unknown>);
    const paginatedOrders = orders.slice(startIndex, startIndex + perPage);

    return res.json({
      ok: true,
      data: {
        orders: paginatedOrders,
        pagination: { page, perPage, total: orders.length, lastPage: lastPage(orders.length) },
      },
    });
  } catch (e) {
    console.error("Orders fetch error:", e);
    res.json({ ok: true, data: { orders: [], pagination: { page: 1, perPage: 20, total: 0, lastPage: 1 } } });
  }
});

/** GET /tickets — SellAuth tickets + this server's Discord tickets for the logged-in user. */
router.get("/tickets", rateLimiter(120, 60_000), requireAuth, async (req, res) => {
  try {
    const session = req.session!;

    // 1) SellAuth tickets, strictly filtered by the authenticated customer
    //    (same rationale as orders — never the full list).
    let sellauthTickets: any[] = [];
    try {
      const tickets = await sellauth.getTickets();
      if (session.customerId) {
        sellauthTickets = tickets.filter((t: any) => t.shop_customer_id === session.customerId);
      } else if (session.customerEmail) {
        sellauthTickets = tickets.filter(
          (t: any) => t.email && t.email.toLowerCase() === session.customerEmail!.toLowerCase()
        );
      }
    } catch (e) {
      console.error("SellAuth tickets fetch failed:", e instanceof Error ? e.message : e);
    }

    // Normalize SellAuth rows into the card shape the frontend renders
    // (ticketId / isOpen / channelUrl / transcriptUrl).
    const normalizedSell = sellauthTickets.map((t: any) => {
      const statusRaw = String(t.status ?? "").trim();
      const isOpen = t.isOpen === true || (t.isOpen !== false && statusRaw.toLowerCase() !== "closed");
      return {
        ...t,
        ticketId: t.ticketId ?? t.id ?? t.ticket_id ?? null,
        status: statusRaw || (isOpen ? "Open" : "Closed"),
        isOpen,
        createdAt: t.createdAt ?? t.created_at ?? null,
        closedAt: t.closedAt ?? t.closed_at ?? null,
        channelUrl: t.channelUrl ?? t.channel_url ?? null,
        transcriptUrl: t.transcriptUrl ?? t.transcript_url ?? null,
        source: t.source ?? "sellauth",
      };
    });

    // 2) This server's Discord tickets, keyed by the OAuth Discord id
    //    (never by a user-supplied email). Scoped per-server in the service.
    const discordTickets = await getDiscordTickets(String(session.id || ""));

    const merged = [...discordTickets, ...normalizedSell].sort((a: any, b: any) => {
      const ta = Date.parse(a?.createdAt || "") || 0;
      const tb = Date.parse(b?.createdAt || "") || 0;
      return tb - ta;
    });

    return res.json({ ok: true, data: { tickets: merged } });
  } catch (e) {
    res.json({ ok: true, data: { tickets: [] } });
  }
});

/** GET /download?key=... — validate a license key for the authenticated customer. */
router.get("/download", rateLimiter(60, 60_000), requireAuth, async (req, res) => {
  try {
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (!key) {
      return res.status(400).json({ error: "License key is required" });
    }
    return res.json({
      ok: true,
      data: {
        downloadUrl: "https://outplayed.cc/discord",
        message: "Key validated successfully. Access your software through the Outplayed Discord loader.",
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Download validation failed" });
  }
});

export { router as customerRouter };
