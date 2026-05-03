"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

function normalizeNotificationsBasePath(raw?: string): string {
  const b = (raw ?? "/notifications").trim().replace(/\/$/, "");
  return b || "/notifications";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import {
  Gamepad2,
  Bird,
  Users,
  Mail,
  BellRing,
  ShieldAlert,
  Bell,
  Plus,
  Search,
  Send,
  Trash2,
  MessageCircle,
  MessagesSquare,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  Loader2,
  Pencil,
  X,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useOptionalOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import {
  orgMemberAllowsNotificationsAdd,
  orgMemberAllowsNotificationsEdit,
  orgMemberAllowsNotificationsTest,
} from "@/lib/org-workspace-permissions";
import {
  createNotificationChannel,
  bulkDeleteNotificationChannels,
  deleteNotificationChannel,
  fetchNotificationChannelsPaged,
  testNotificationChannel,
  updateNotificationChannel,
  notificationChannelRouteId,
  type NotificationChannel,
  type PaginatedNotificationChannelsResponse,
} from "@/lib/notifications-api";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import { ListPagination } from "@/components/docker/ListPagination";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

function TelegramLogoIcon({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="9.858" x2="38.142" y1="9.858" y2="38.142" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#33bef0" />
          <stop offset="1" stopColor="#0a85d9" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d="M44,24c0,11.045-8.955,20-20,20S4,35.045,4,24S12.955,4,24,4S44,12.955,44,24z" />
      <path
        d="M10.119,23.466c8.155-3.695,17.733-7.704,19.208-8.284c3.252-1.279,4.67,0.028,4.448,2.113 c-0.273,2.555-1.567,9.99-2.363,15.317c-0.466,3.117-2.154,4.072-4.059,2.863c-1.445-0.917-6.413-4.17-7.72-5.282 c-0.891-0.758-1.512-1.608-0.88-2.474c0.185-0.253,0.658-0.763,0.921-1.017c1.319-1.278,1.141-1.553-0.454-0.412 c-0.19,0.136-1.292,0.935-1.745,1.237c-1.11,0.74-2.131,0.78-3.862,0.192c-1.416-0.481-2.776-0.852-3.634-1.223 C8.794,25.983,8.34,24.272,10.119,23.466z"
        opacity="0.05"
      />
      <path
        d="M10.836,23.591c7.572-3.385,16.884-7.264,18.246-7.813c3.264-1.318,4.465-0.536,4.114,2.011 c-0.326,2.358-1.483,9.654-2.294,14.545c-0.478,2.879-1.874,3.513-3.692,2.337c-1.139-0.734-5.723-3.754-6.835-4.633 c-0.86-0.679-1.751-1.463-0.71-2.598c0.348-0.379,2.27-2.234,3.707-3.614c0.833-0.801,0.536-1.196-0.469-0.508 c-1.843,1.263-4.858,3.262-5.396,3.625c-1.025,0.69-1.988,0.856-3.664,0.329c-1.321-0.416-2.597-0.819-3.262-1.078 C9.095,25.618,9.075,24.378,10.836,23.591z"
        opacity="0.07"
      />
      <path
        fill="#fff"
        d="M11.553,23.717c6.99-3.075,16.035-6.824,17.284-7.343c3.275-1.358,4.28-1.098,3.779,1.91 c-0.36,2.162-1.398,9.319-2.226,13.774c-0.491,2.642-1.593,2.955-3.325,1.812c-0.833-0.55-5.038-3.331-5.951-3.984 c-0.833-0.595-1.982-1.311-0.541-2.721c0.513-0.502,3.874-3.712,6.493-6.21c0.343-0.328-0.088-0.867-0.484-0.604 c-3.53,2.341-8.424,5.59-9.047,6.013c-0.941,0.639-1.845,0.932-3.467,0.466c-1.226-0.352-2.423-0.772-2.889-0.932 C9.384,25.282,9.81,24.484,11.553,23.717z"
      />
    </svg>
  );
}

function SlackLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 2707 2707"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="m897.4 0c-135.3.1-244.8 109.9-244.7 245.2-.1 135.3 109.5 245.1 244.8 245.2h244.8v-245.1c.1-135.3-109.5-245.1-244.9-245.3.1 0 .1 0 0 0m0 654h-652.6c-135.3.1-244.9 109.9-244.8 245.2-.2 135.3 109.4 245.1 244.7 245.3h652.7c135.3-.1 244.9-109.9 244.8-245.2.1-135.4-109.5-245.2-244.8-245.3z"
        fill="#36c5f0"
      />
      <path
        d="m2447.6 899.2c.1-135.3-109.5-245.1-244.8-245.2-135.3.1-244.9 109.9-244.8 245.2v245.3h244.8c135.3-.1 244.9-109.9 244.8-245.3zm-652.7 0v-654c.1-135.2-109.4-245-244.7-245.2-135.3.1-244.9 109.9-244.8 245.2v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.3z"
        fill="#2eb67d"
      />
      <path
        d="m1550.1 2452.5c135.3-.1 244.9-109.9 244.8-245.2.1-135.3-109.5-245.1-244.8-245.2h-244.8v245.2c-.1 135.2 109.5 245 244.8 245.2zm0-654.1h652.7c135.3-.1 244.9-109.9 244.8-245.2.2-135.3-109.4-245.1-244.7-245.3h-652.7c-135.3.1-244.9 109.9-244.8 245.2-.1 135.4 109.4 245.2 244.7 245.3z"
        fill="#ecb22e"
      />
      <path
        d="m0 1553.2c-.1 135.3 109.5 245.1 244.8 245.2 135.3-.1 244.9-109.9 244.8-245.2v-245.2h-244.8c-135.3.1-244.9 109.9-244.8 245.2zm652.7 0v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.2v-653.9c.2-135.3-109.4-245.1-244.7-245.3-135.4 0-244.9 109.8-244.8 245.1 0 0 0 .1 0 0"
        fill="#e01e5a"
      />
    </svg>
  );
}

function DiscordLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#536dfe"
        d="M39.248,10.177c-2.804-1.287-5.812-2.235-8.956-2.778c-0.057-0.01-0.114,0.016-0.144,0.068 c-0.387,0.688-0.815,1.585-1.115,2.291c-3.382-0.506-6.747-0.506-10.059,0c-0.3-0.721-0.744-1.603-1.133-2.291 c-0.03-0.051-0.087-0.077-0.144-0.068c-3.143,0.541-6.15,1.489-8.956,2.778c-0.024,0.01-0.045,0.028-0.059,0.051 c-5.704,8.522-7.267,16.835-6.5,25.044c0.003,0.04,0.026,0.079,0.057,0.103c3.763,2.764,7.409,4.442,10.987,5.554 c0.057,0.017,0.118-0.003,0.154-0.051c0.846-1.156,1.601-2.374,2.248-3.656c0.038-0.075,0.002-0.164-0.076-0.194 c-1.197-0.454-2.336-1.007-3.432-1.636c-0.087-0.051-0.094-0.175-0.014-0.234c0.231-0.173,0.461-0.353,0.682-0.534 c0.04-0.033,0.095-0.04,0.142-0.019c7.201,3.288,14.997,3.288,22.113,0c0.047-0.023,0.102-0.016,0.144,0.017 c0.22,0.182,0.451,0.363,0.683,0.536c0.08,0.059,0.075,0.183-0.012,0.234c-1.096,0.641-2.236,1.182-3.434,1.634 c-0.078,0.03-0.113,0.12-0.075,0.196c0.661,1.28,1.415,2.498,2.246,3.654c0.035,0.049,0.097,0.07,0.154,0.052 c3.595-1.112,7.241-2.79,11.004-5.554c0.033-0.024,0.054-0.061,0.057-0.101c0.917-9.491-1.537-17.735-6.505-25.044 C39.293,10.205,39.272,10.187,39.248,10.177z M16.703,30.273c-2.168,0-3.954-1.99-3.954-4.435s1.752-4.435,3.954-4.435 c2.22,0,3.989,2.008,3.954,4.435C20.658,28.282,18.906,30.273,16.703,30.273z M31.324,30.273c-2.168,0-3.954-1.99-3.954-4.435 s1.752-4.435,3.954-4.435c2.22,0,3.989,2.008,3.954,4.435C35.278,28.282,33.544,30.273,31.324,30.273z"
      />
    </svg>
  );
}

function LarkLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="m12.924 12.803.056-.054c.038-.034.076-.072.11-.11l.077-.076.23-.227 1.334-1.319.335-.331c.063-.063.13-.123.195-.183a7.777 7.777 0 0 1 1.823-1.24 7.607 7.607 0 0 1 1.014-.4 13.177 13.177 0 0 0-2.5-5.013 1.203 1.203 0 0 0-.94-.448h-9.65c-.173 0-.246.224-.107.325a28.23 28.23 0 0 1 8 9.098c.007-.006.016-.013.023-.022Z"
        fill="#00D6B9"
      />
      <path
        d="M9.097 21.299a13.258 13.258 0 0 0 11.82-7.247 5.576 5.576 0 0 1-.731 1.076 5.315 5.315 0 0 1-.745.7 5.117 5.117 0 0 1-.615.404 4.626 4.626 0 0 1-.726.331 5.312 5.312 0 0 1-1.883.312 5.892 5.892 0 0 1-.524-.031 6.509 6.509 0 0 1-.729-.126c-.06-.016-.12-.029-.18-.044-.166-.044-.33-.092-.494-.14-.082-.024-.164-.046-.246-.072-.123-.038-.247-.072-.366-.11l-.3-.095-.284-.094-.192-.067c-.08-.025-.155-.053-.234-.082a3.49 3.49 0 0 1-.167-.06c-.11-.04-.221-.079-.328-.12-.063-.025-.126-.047-.19-.072l-.252-.098c-.088-.035-.18-.07-.268-.107l-.174-.07c-.072-.028-.141-.06-.214-.088l-.164-.07c-.057-.024-.114-.05-.17-.075l-.149-.066-.135-.06-.14-.063a90.183 90.183 0 0 1-.141-.066 4.808 4.808 0 0 0-.18-.083c-.063-.028-.123-.06-.186-.088a5.697 5.697 0 0 1-.199-.098 27.762 27.762 0 0 1-8.067-5.969.18.18 0 0 0-.312.123l.006 9.21c0 .4.199.779.533 1a13.177 13.177 0 0 0 7.326 2.205Z"
        fill="#3370FF"
      />
      <path
        d="M23.732 9.295a7.55 7.55 0 0 0-3.35-.776 7.521 7.521 0 0 0-2.284.35c-.054.016-.107.035-.158.05a8.297 8.297 0 0 0-.855.35 7.14 7.14 0 0 0-.552.297 6.716 6.716 0 0 0-.533.347c-.123.089-.243.18-.363.275-.13.104-.252.211-.375.321-.067.06-.13.123-.196.184l-.334.328-1.338 1.321-.23.228-.076.075c-.038.038-.076.073-.11.11l-.057.054a1.914 1.914 0 0 1-.085.08c-.032.028-.063.06-.095.088a13.286 13.286 0 0 1-2.748 1.946c.06.028.12.057.18.082l.142.066c.044.022.091.041.139.063l.135.06.149.067.17.075.164.07c.073.031.142.06.215.088.056.025.116.047.173.07.088.034.177.072.268.107.085.031.168.066.253.098l.189.072c.11.041.218.082.328.12.057.019.11.041.167.06.08.028.155.053.234.082l.192.066.284.095.3.095c.123.037.243.075.366.11l.246.072c.164.048.331.095.495.14.06.015.12.03.18.043.114.029.227.05.34.07.13.022.26.04.389.057a5.815 5.815 0 0 0 .994.019 5.172 5.172 0 0 0 1.413-.3 5.405 5.405 0 0 0 .726-.334c.06-.035.122-.07.182-.108a7.96 7.96 0 0 0 .432-.297 5.362 5.362 0 0 0 .577-.517 5.285 5.285 0 0 0 .37-.429 5.797 5.797 0 0 0 .527-.827l.13-.258 1.166-2.325-.003.006a7.391 7.391 0 0 1 1.527-2.186Z"
        fill="#133C9A"
      />
    </svg>
  );
}

/** Microsoft Teams tiles + “T” mark. */
function TeamsEmailTilesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g>
        <rect x="116" y="50" width="280" height="276" rx="64" fill="#6264A7" />
        <rect x="236" y="138" width="180" height="224" rx="60" fill="#5059C9" />
        <circle cx="122" cy="332" r="80" fill="#B2B4D3" />
        <circle cx="370" cy="364" r="64" fill="#A6A7DC" />
        <text
          x="180"
          y="270"
          fill="#fff"
          fontFamily="Segoe UI, Arial, sans-serif"
          fontSize="110"
          fontWeight="bold"
        >
          T
        </text>
      </g>
    </svg>
  );
}

const MicrosoftTeamsLogoIcon = TeamsEmailTilesIcon;

function EmailLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        width="20"
        height="16"
        x="2"
        y="4"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Resend logo mark; color via `currentColor`. */
function ResendLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1800 1800" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M1000.46 450C1174.77 450 1278.43 553.669 1278.43 691.282C1278.43 828.896 1174.77 932.563 1000.46 932.563H912.382L1350 1350H1040.82L707.794 1033.48C683.944 1011.47 672.936 985.781 672.935 963.765C672.935 932.572 694.959 905.049 737.161 893.122L908.712 847.244C973.85 829.812 1018.81 779.353 1018.81 713.298C1018.8 632.567 952.745 585.78 871.095 585.78H450V450H1000.46Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GotifyLogoIcon({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, "");
  return (
    <svg
      className={className}
      viewBox="60 0 520 620"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <style>{`
          .gotify-st0{fill:#DDCBA2;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st1{fill:#71CAEE;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st2{fill:#FFFFFF;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st3{fill:#888E93;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st4{fill:#F0F0F0;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st5{fill:none;stroke:#000000;stroke-width:2;stroke-linecap:round;stroke-miterlimit:10;}
          .gotify-st8{fill:#FFFFFF;}
        `}</style>
        <linearGradient id={gradientId} x1="265" y1="280" x2="275" y2="302" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#71CAEE" />
          <stop offset="0.04" stopColor="#83CAE2" />
          <stop offset="0.12" stopColor="#9FCACE" />
          <stop offset="0.21" stopColor="#B6CBBE" />
          <stop offset="0.31" stopColor="#C7CBB1" />
          <stop offset="0.44" stopColor="#D4CBA8" />
          <stop offset="0.61" stopColor="#DBCBA3" />
          <stop offset="1" stopColor="#DDCBA2" />
        </linearGradient>
      </defs>
      <g transform="matrix(2.33,0,0,2.33,-432,-323)">
        <g transform="translate(-25,26)">
          <path
            className="gotify-st1"
            d="m258.9,119.7c-3,-0.9-6,-1.8-9,-2.7-4.6,-1.4-9.2,-2.8-14,-2.5-2.8,0.2-6.1,1.3-6.9,4-0.6,2-1.6,7.3-1.3,7.9 1.5,3.4 13.9,6.7 18.3,6.7"
          />
          <path
            fill="#000000"
            d="m392.6,177.9c-1.4,1.4-2.2,3.5-2.5,5.5-0.2,1.4-0.1,3 0.5,4.3 0.6,1.3 1.8,2.3 3.1,3 1.3,0.6 2.8,0.9 4.3,0.9 1.1,0 2.3,-0.1 3.1,-0.9 0.6,-0.7 0.8,-1.6 0.9,-2.5 0.2,-2.3-0.1,-4.7-0.9,-6.9-0.4,-1.1-0.9,-2.3-1.8,-3.1-1.7,-1.8-4.5,-2.2-6.4,-0.5-0.1,0-0.2,0.1-0.3,0.2z"
          />
          <path
            className="gotify-st2"
            d="m358.5,164.2c-1,-1 0,-2.7 1,-3.7 5.8,-5.2 15.1,-4.6 21.8,-0.6 10.9,6.6 15.6,19.9 17.2,32.5 0.6,5.2 0.9,10.6-0.5,15.7-1.4,5.1-4.6,9.9-9.3,12.1-1.1,0.5-2.3,0.9-3.4,0.5-1.1,-0.4-1.9,-1.8-1.2,-2.8-9.4,-13.6-19,-26.8-20.9,-43.2-0.5,-4.1-1.8,-7.4-4.7,-10.5z"
          />
          <path
            className="gotify-st1"
            d="m220.1,133c34.6,-18 79.3,-19.6 112.2,-8.7 23.7,7.9 41.3,26.7 49.5,50 7.1,20.6 7.1,43.6 3,65.7-7.5,40.2-26.2,77.9-49,112.6-12.6,19-24.6,36-44.2,48.5-38.7,24.6-88.9,22.1-129.3,11.5-19.5,-5.1-38.4,-17.3-44.3,-37.3-3.8,-12.8-2.1,-27.6 4.6,-40 13.5,-24.8 46.2,-38.4 50.8,-67.9 1.4,-8.7-0.3,-17.3-1.6,-25.7-3.8,-23.4-5.4,-45.8 6.7,-68.7 9.5,-17.7 24.3,-31 41.7,-40z"
          />
          <path
            className="gotify-st2"
            d="m264.5,174.9c-0.5,0.5-0.9,1-1.3,1.6-9,11.6-12,27.9-9.3,42.1 1.7,9 5.9,17.9 13.2,23.4 19.3,14.6 51.5,13.5 68.4,-1.5 24.4,-21.7 13,-67.6-14,-78.8-17.6,-7.2-43.7,-1.6-57,13.2z"
          />
          <path
            className="gotify-st2"
            d="m382.1,237.1c1.4,-0.1 2.9,-0.1 4.3,0.1 0.3,0 0.7,0.1 1,0.4 0.2,0.3 0.4,0.7 0.5,1.1 1,3.9 0.5,8.2 0.1,12.4-0.1,0.9-0.2,1.8-0.6,2.6-1,2.1-3.1,2.7-4.7,2.7-0.1,0-0.2,0-0.3,-0.1-0.3,-0.2-0.3,-0.7-0.2,-1.2 0.3,-5.9-0.1,-11.9-0.1,-18z"
          />
          <path
            className="gotify-st2"
            d="m378.7,236.8c-1.4,0.4-2.5,2-2.8,4.4-0.5,4.4-0.7,8.9-0.5,13.4 0,0.9 0.1,1.9 0.5,2.4 0.2,0.3 0.5,0.4 0.8,0.4 1.6,0.3 4.1,-0.6 5.6,-1 0,0 0,-5.2-0.1,-8-0.1,-2.8-0.1,-6.1-0.2,-8.9 0,-0.6 0,-1.5 0,-2.2 0.1,-0.7-2.6,-0.7-3.3,-0.5z"
          />
          <path
            className="gotify-st0"
            d="m358.3,231.8c-0.3,2.2 0.1,4.7 1.7,7.4 2.6,4.4 7,6.1 11.9,5.8 8.9,-0.6 25.3,-5.4 27.5,-15.7 0.6,-3-0.3,-6.1-2.2,-8.5-6.2,-7.8-17.8,-5.7-25.6,-2-5.9,2.7-12.4,7-13.3,13z"
          />
          <path
            className="gotify-st3"
            d="m386.4,208.6c2.2,1.4 3.7,3.8 4,7 0.3,3.6-1.4,7.5-5,8.8-2.9,1.1-6.2,0.6-9.1,-0.4-2.9,-1-5.8,-2.8-6.8,-5.7-0.7,-2-0.3,-4.3 0.7,-6.1 1.1,-1.8 2.8,-3.2 4.7,-4.1 3.9,-1.8 8.4,-1.6 11.5,0.5z"
          />
          <path
            className="gotify-st0"
            d="m414.7,262.6c2.4,0.6 4.8,2.1 5.6,4.4 0.8,2.3 0.1,4.9-1.6,6.7-1.7,1.8-4.2,2.5-6.6,2.5-0.8,0-1.7,-0.1-2.4,-0.5-2.5,-1.1-3.5,-4-4.2,-6.6-1.8,-6.8 3.6,-7.8 9.2,-6.5z"
          />
          <path
            className="gotify-st4"
            d="m267.1,284.7c2.3,-4.5 141.3,-36.2 144.7,-31.6 3.4,4.5 15.8,88.2 9,90.4-6.8,2.3-119.8,37.3-126.6,35-6.8,-2.3-29.4,-89.3-27.1,-93.8z"
          />
          <path className="gotify-st5" d="m294.2,378.5c0,0 54.3,-74.6 59.9,-76.9 5.7,-2.3 67.3,41.3 67.3,41.3" />
          <path
            className="gotify-st4"
            d="m267,287.7c0,0 86,38.8 91.6,36.6 5.7,-2.3 53.1,-71.2 53.1,-71.2"
          />
          <path fill={`url(#${gradientId})`} d="m261.9,283.5c-0.1,4.2 4.3,7.3 8.4,7.6 4.1,0.3 8.2,-1.3 12.2,-2.6 1.4,-0.4 2.9,-0.8 4.2,-0.2 1.8,0.9 2.7,4.1 1.8,5.9-0.9,1.8-3.4,3.5-5.3,4.4-6.5,3-12.9,3.6-19.9,2-5.3,-1.2-11.3,-4.3-13,-13.5" />
          <path
            fill="#000000"
            d="m318.4,198.4c-2,-0.3-4.1,0.1-5.9,1.3-3.2,2.1-4.7,6.2-4.7,9.9 0,1.9 0.4,3.8 1.4,5.3 1.2,1.7 3.1,2.9 5.2,3.4 3.4,0.8 8.2,0.7 10.5,-2.5 1,-1.5 1.4,-3.3 1.5,-5.1 0.5,-5.7-1.8,-11.4-8,-12.3z"
          />
          <path
            className="gotify-st8"
            d="m320.4,203.3c0.9,0.3 1.7,0.8 2.1,1.7 0.4,0.8 0.4,1.7 0.3,2.5-0.1,1-0.6,2-1.5,2.7-0.7,0.5-1.7,0.7-2.6,0.5-0.9,-0.2-1.7,-0.8-2.2,-1.6-1.1,-1.6-0.9,-4.4 0.9,-5.5 0.9,-0.4 2,-0.6 3,-0.3z"
          />
        </g>
      </g>
    </svg>
  );
}

function NtfyLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="currentColor"
        d="M12.597 13.693v2.156h6.205v-2.156ZM5.183 6.549v2.363l3.591 1.901 0.023 0.01 -0.023 0.009 -3.591 1.901v2.35l0.386 -0.211 5.456 -2.969V9.729ZM3.659 2.037C1.915 2.037 0.42 3.41 0.42 5.154v0.002L0.438 18.73 0 21.963l5.956 -1.583h14.806c1.744 0 3.238 -1.374 3.238 -3.118V5.154c0 -1.744 -1.493 -3.116 -3.237 -3.117h-0.001zm0 2.2h17.104c0.613 0.001 1.037 0.447 1.037 0.917v12.108c0 0.47 -0.424 0.916 -1.038 0.916H5.633l-3.026 0.915 0.031 -0.179 -0.017 -13.76c0 -0.47 0.424 -0.917 1.038 -0.917z"
      />
    </svg>
  );
}

function PushoverLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="120 105 360 390" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g stroke="none" strokeWidth={1}>
        <ellipse
          fillRule="evenodd"
          fill="#249DF1"
          transform="matrix(-0.674571, 0.73821, -0.73821, -0.674571, 556.833239, 241.613465)"
          cx="216.308"
          cy="152.076"
          rx="296.855"
          ry="296.855"
        />
        <path
          fill="#FFFFFF"
          d="M 280.949 172.514 L 355.429 162.714 L 282.909 326.374 L 282.909 326.374 C 295.649 325.394 308.142 321.067 320.389 313.394 L 320.389 313.394 L 320.389 313.394 C 332.642 305.714 343.916 296.077 354.209 284.484 L 354.209 284.484 L 354.209 284.484 C 364.496 272.884 373.396 259.981 380.909 245.774 L 380.909 245.774 L 380.909 245.774 C 388.422 231.561 393.812 217.594 397.079 203.874 L 397.079 203.874 L 397.079 203.874 C 399.039 195.381 399.939 187.214 399.779 179.374 L 399.779 179.374 L 399.779 179.374 C 399.612 171.534 397.569 164.674 393.649 158.794 L 393.649 158.794 L 393.649 158.794 C 389.729 152.914 383.766 148.177 375.759 144.584 L 375.759 144.584 L 375.759 144.584 C 367.759 140.991 356.899 139.194 343.179 139.194 L 343.179 139.194 L 343.179 139.194 C 327.172 139.194 311.409 141.807 295.889 147.034 L 295.889 147.034 L 295.889 147.034 C 280.376 152.261 266.002 159.857 252.769 169.824 L 252.769 169.824 L 252.769 169.824 C 239.542 179.784 228.029 192.197 218.229 207.064 L 218.229 207.064 L 218.229 207.064 C 208.429 221.924 201.406 238.827 197.159 257.774 L 197.159 257.774 L 197.159 257.774 C 195.526 263.981 194.546 268.961 194.219 272.714 L 194.219 272.714 L 194.219 272.714 C 193.892 276.474 193.812 279.577 193.979 282.024 L 193.979 282.024 L 193.979 282.024 C 194.139 284.477 194.462 286.357 194.949 287.664 L 194.949 287.664 L 194.949 287.664 C 195.442 288.971 195.852 290.277 196.179 291.584 L 196.179 291.584 L 196.179 291.584 C 179.519 291.584 167.349 288.234 159.669 281.534 L 159.669 281.534 L 159.669 281.534 C 151.996 274.841 150.119 263.164 154.039 246.504 L 154.039 246.504 L 154.039 246.504 C 157.959 229.191 166.862 212.694 180.749 197.014 L 180.749 197.014 L 180.749 197.014 C 194.629 181.334 211.122 167.531 230.229 155.604 L 230.229 155.604 L 230.229 155.604 C 249.342 143.684 270.249 134.214 292.949 127.194 L 292.949 127.194 L 292.949 127.194 C 315.656 120.167 337.789 116.654 359.349 116.654 L 359.349 116.654 L 359.349 116.654 C 378.296 116.654 394.219 119.347 407.119 124.734 L 407.119 124.734 L 407.119 124.734 C 420.026 130.127 430.072 137.234 437.259 146.054 L 437.259 146.054 L 437.259 146.054 C 444.446 154.874 448.936 165.164 450.729 176.924 L 450.729 176.924 L 450.729 176.924 C 452.529 188.684 451.959 200.934 449.019 213.674 L 449.019 213.674 L 449.019 213.674 C 445.426 229.027 438.646 244.464 428.679 259.984 L 428.679 259.984 L 428.679 259.984 C 418.719 275.497 406.226 289.544 391.199 302.124 L 391.199 302.124 L 391.199 302.124 C 376.172 314.697 358.939 324.904 339.499 332.744 L 339.499 332.744 L 339.499 332.744 C 320.066 340.584 299.406 344.504 277.519 344.504 L 277.519 344.504 L 275.069 344.504 L 212.839 484.154 L 142.279 484.154 L 280.949 172.514 Z"
        />
      </g>
    </svg>
  );
}

/** Add-channel provider grid: 28×28 slot; Pushover uses circular clip. */
const CHANNEL_ICON_PICKER_WRAP =
  "inline-flex size-7 shrink-0 items-center justify-center align-middle [&_svg]:h-full [&_svg]:w-full [&_svg]:max-h-7 [&_svg]:max-w-7";
const CHANNEL_ICON_PICKER_WRAP_PUSH = `${CHANNEL_ICON_PICKER_WRAP} overflow-hidden rounded-full`;
const CHANNEL_ICON_PICKER_INNER = "h-full w-full min-h-0 min-w-0";

/** Channel list cards: 32×32 artwork bounds; Pushover circular. */
const CHANNEL_ICON_CARD_WRAP =
  "inline-flex size-8 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:max-h-8 [&_svg]:max-w-8";
const CHANNEL_ICON_CARD_WRAP_PUSH = `${CHANNEL_ICON_CARD_WRAP} overflow-hidden rounded-full`;
const CHANNEL_ICON_CARD_INNER = "h-full w-full min-h-0 min-w-0";

const CHANNEL_TYPE_OPTIONS = [
  { value: "telegram", label: "Telegram", icon: Send, iconClass: "text-sky-400" },
  { value: "discord", label: "Discord", icon: Gamepad2, iconClass: "text-indigo-400" },
  { value: "slack", label: "Slack", icon: MessagesSquare, iconClass: "text-purple-400" },
  { value: "lark", label: "Lark", icon: Bird, iconClass: "text-cyan-400" },
  { value: "microsoft-teams", label: "Microsoft Teams", icon: Users, iconClass: "text-blue-400" },
  { value: "gotify", label: "Gotify", icon: BellRing, iconClass: "text-lime-400" },
  { value: "ntfy", label: "ntfy", icon: Bell, iconClass: "text-black dark:text-white" },
  { value: "pushover", label: "Pushover", icon: ShieldAlert, iconClass: "text-rose-400" },
] as const;

const channelTypeLabel = (type: string) =>
  CHANNEL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
const channelTypeMeta = (type: string) =>
  CHANNEL_TYPE_OPTIONS.find((option) => option.value === type);
const isTelegramChannel = (type: string) => type === "telegram";
const isDiscordChannel = (type: string) => type === "discord";
const isSlackChannel = (type: string) => type === "slack";
const isLarkChannel = (type: string) => type === "lark";
const isMicrosoftTeamsChannel = (type: string) => type === "microsoft-teams";
const isEmailChannel = (type: string) => type === "email";
const isResendChannel = (type: string) => type === "resend";
const isGotifyChannel = (type: string) => type === "gotify";
const isNtfyChannel = (type: string) => type === "ntfy";
const isPushoverChannel = (type: string) => type === "pushover";
const formatDateUTC = (dateInput: string) => {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

export function NotificationsChannelsClient({
  initialData,
  initialError,
  urlPage,
  urlQ,
  initialMode,
  initialRouteChannel,
  notificationsBasePath,
  organizationPublicId: organizationPublicIdProp,
}: {
  initialData: PaginatedNotificationChannelsResponse | null;
  initialError: string | null;
  urlPage: number;
  urlQ: string;
  initialMode?: "create" | "edit";
  initialRouteChannel?: NotificationChannel | null;
  /** List root, e.g. `/notifications` or `/organizations/:id/notifications`. */
  notificationsBasePath?: string;
  /** When set (e.g. SSR org mirror), scopes API calls to this organization. */
  organizationPublicId?: string;
}) {
  const pathname = usePathname();
  const listBase = useMemo(
    () => normalizeNotificationsBasePath(notificationsBasePath),
    [notificationsBasePath],
  );
  const isCreateRoute = pathname === `${listBase}/create`;
  const isEditRoute = useMemo(
    () => new RegExp(`^${escapeRegExp(listBase)}/[^/]+/edit$`).test(pathname),
    [listBase, pathname],
  );
  const router = useRouter();
  const { accessToken } = useAuth();
  const orgWorkspace = useOptionalOrgWorkspace();
  const organizationPublicId =
    organizationPublicIdProp?.trim() || orgWorkspace?.publicId?.trim() || undefined;
  const inOrgNotifications =
    organizationPublicId != null && String(organizationPublicId).trim() !== "";
  const allowNotificationsAdd =
    !inOrgNotifications ||
    (orgWorkspace != null &&
      orgMemberAllowsNotificationsAdd(orgWorkspace.workspacePermissions));
  const allowNotificationsEdit =
    !inOrgNotifications ||
    (orgWorkspace != null &&
      orgMemberAllowsNotificationsEdit(orgWorkspace.workspacePermissions));
  const allowNotificationsTest =
    !inOrgNotifications ||
    (orgWorkspace != null &&
      orgMemberAllowsNotificationsTest(orgWorkspace.workspacePermissions));
  const orgSegment = orgScopedQuerySegment(organizationPublicId);
  const remoteServersQueryKey = ["remote-servers", orgSegment] as const;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const CHANNELS_PAGE_SIZE = 10;
  const [channelsPage, setChannelsPage] = useState(urlPage);
  const [channelsQ, setChannelsQ] = useState(urlQ);
  const [channelsLocalQ, setChannelsLocalQ] = useState(urlQ);

  useEffect(() => {
    setChannelsPage(urlPage);
    setChannelsQ(urlQ);
    setChannelsLocalQ(urlQ);
  }, [urlPage, urlQ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = channelsLocalQ.trim();
      if (trimmed === channelsQ.trim()) return;
      setChannelsQ(trimmed);
      setChannelsPage(1);
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 400);
    return () => window.clearTimeout(t);
  }, [channelsLocalQ, channelsQ, pathname, router]);

  const remoteServersQuery = useQuery({
    queryKey: remoteServersQueryKey,
    queryFn: () =>
      fetchRemoteServers(
        accessToken!,
        organizationPublicId ? organizationPublicId : undefined,
      ),
    enabled: Boolean(accessToken && orgSegment),
    staleTime: 120_000,
  });
  const deployServers = useMemo(
    () => filterSshDeployServers(remoteServersQuery.data ?? []),
    [remoteServersQuery.data],
  );

  const channelsPagedQuery = useQuery({
    queryKey: ["notifications", "channels", "paged", orgSegment, channelsPage, channelsQ],
    queryFn: () =>
      fetchNotificationChannelsPaged(
        accessToken!,
        channelsPage,
        CHANNELS_PAGE_SIZE,
        channelsQ,
        organizationPublicId,
      ),
    enabled: Boolean(accessToken && orgSegment),
    initialData:
      channelsPage === urlPage && channelsQ.trim() === urlQ.trim()
        ? (initialData ?? undefined)
        : undefined,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const channelsPaged = channelsPagedQuery.data;
  const channels = channelsPaged?.items ?? [];
  const channelKeys = useMemo(() => channels.map((c) => notificationChannelRouteId(c)), [channels]);
  const channelsBulk = useBulkSelection(channelKeys);

  const [showAdd, setShowAdd] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Set<string>>(new Set());
  const [showChannelAction, setShowChannelAction] = useState(false);
  const [actionChannel, setActionChannel] = useState<{
    id: number;
    name: string;
    remoteServerId: number | null;
  } | null>(null);
  const [testActionRemoteId, setTestActionRemoteId] = useState<number | "">("");
  const [showEditChannel, setShowEditChannel] = useState(false);
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(null);
  const [editName, setEditName] = useState("");
  const [editDeployServerId, setEditDeployServerId] = useState<number | "">("");

  const [form, setForm] = useState({ name: "", type: "telegram" });
  /** Deploy host selected only for draft Test in add modal (optional; same pattern as S3 verify). */
  const [addTestRemoteId, setAddTestRemoteId] = useState<number | null>(null);
  const [telegramForm, setTelegramForm] = useState({ token: "", target: "" });
  const [emailForm, setEmailForm] = useState({
    smtpServer: "smtp.gmail.com",
    smtpPort: "587",
    username: "",
    password: "",
    fromAddress: "",
    toAddresses: [""],
  });
  const [discordForm, setDiscordForm] = useState({ webhookUrl: "" });
  const [slackForm, setSlackForm] = useState({ webhookUrl: "" });
  const [larkForm, setLarkForm] = useState({ webhookUrl: "", secret: "" });
  const [teamsForm, setTeamsForm] = useState({ webhookUrl: "" });
  const [resendForm, setResendForm] = useState({ apiKey: "", fromAddress: "", toAddress: "" });
  const [gotifyForm, setGotifyForm] = useState({ serverUrl: "", appToken: "", priority: "5" });
  const [ntfyForm, setNtfyForm] = useState({ serverUrl: "https://ntfy.sh", topic: "", token: "" });
  const [pushoverForm, setPushoverForm] = useState({ userKey: "", appToken: "", device: "" });

  const openAddChannelModal = useCallback(() => {
    if (inOrgNotifications && !allowNotificationsAdd) {
      toast({
        title: "Not allowed",
        description: "Your role cannot add notification channels in this organization.",
        variant: "destructive",
      });
      return;
    }
    setAddTestRemoteId(null);
    setShowAdd(true);
  }, [allowNotificationsAdd, inOrgNotifications, toast]);

  useEffect(() => {
    if (initialMode === "create") {
      openAddChannelModal();
      return;
    }
    if (initialMode === "edit" && initialRouteChannel) {
      openEditChannel(initialRouteChannel);
      return;
    }
    
  }, [initialMode, initialRouteChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleOpenAdd = () => openAddChannelModal();
    window.addEventListener("notifications:add-channel", handleOpenAdd);
    return () => window.removeEventListener("notifications:add-channel", handleOpenAdd);
  }, [openAddChannelModal]);

  const addEmailRecipient = () => {
    setEmailForm((prev) => ({ ...prev, toAddresses: [...prev.toAddresses, ""] }));
  };
  const removeEmailRecipient = (index: number) => {
    setEmailForm((prev) => ({
      ...prev,
      toAddresses:
        prev.toAddresses.length === 1
          ? prev.toAddresses
          : prev.toAddresses.filter((_, i) => i !== index),
    }));
  };
  const updateEmailRecipient = (index: number, value: string) => {
    setEmailForm((prev) => ({
      ...prev,
      toAddresses: prev.toAddresses.map((item, i) => (i === index ? value : item)),
    }));
  };
  const platformPayload = (): Record<string, unknown> => {
    const channelType = form.type;
    if (channelType === "telegram") return { token: telegramForm.token.trim(), target: telegramForm.target.trim() };
    if (channelType === "email") {
      const toAddresses = emailForm.toAddresses.map((item) => item.trim()).filter(Boolean);
      return {
        smtpServer: emailForm.smtpServer.trim(),
        smtpPort: emailForm.smtpPort.trim(),
        username: emailForm.username.trim(),
        password: emailForm.password.trim(),
        fromAddress: emailForm.fromAddress.trim(),
        toAddresses,
      };
    }
    if (channelType === "discord") return { webhookUrl: discordForm.webhookUrl.trim() };
    if (channelType === "slack") return { webhookUrl: slackForm.webhookUrl.trim() };
    if (channelType === "lark") return { webhookUrl: larkForm.webhookUrl.trim(), secret: larkForm.secret.trim() };
    if (channelType === "microsoft-teams") return { webhookUrl: teamsForm.webhookUrl.trim() };
    if (channelType === "resend") {
      return { apiKey: resendForm.apiKey.trim(), fromAddress: resendForm.fromAddress.trim(), toAddress: resendForm.toAddress.trim() };
    }
    if (channelType === "gotify") {
      return { serverUrl: gotifyForm.serverUrl.trim(), appToken: gotifyForm.appToken.trim(), priority: gotifyForm.priority.trim() };
    }
    if (channelType === "ntfy") return { serverUrl: ntfyForm.serverUrl.trim(), topic: ntfyForm.topic.trim(), token: ntfyForm.token.trim() };
    if (channelType === "pushover") return { appToken: pushoverForm.appToken.trim(), userKey: pushoverForm.userKey.trim(), device: pushoverForm.device.trim() };
    return {};
  };
  const isPlatformValid = () => {
    if (form.type === "telegram") return Boolean(telegramForm.token.trim() && telegramForm.target.trim());
    if (form.type === "email") {
      return Boolean(
        emailForm.smtpServer.trim() &&
          emailForm.smtpPort.trim() &&
          emailForm.username.trim() &&
          emailForm.password.trim() &&
          emailForm.fromAddress.trim() &&
          emailForm.toAddresses.some((item) => item.trim()),
      );
    }
    if (form.type === "discord") return Boolean(discordForm.webhookUrl.trim());
    if (form.type === "slack") return Boolean(slackForm.webhookUrl.trim());
    if (form.type === "lark") return Boolean(larkForm.webhookUrl.trim());
    if (form.type === "microsoft-teams") return Boolean(teamsForm.webhookUrl.trim());
    if (form.type === "resend") return Boolean(resendForm.apiKey.trim() && resendForm.fromAddress.trim() && resendForm.toAddress.trim());
    if (form.type === "gotify") return Boolean(gotifyForm.serverUrl.trim() && gotifyForm.appToken.trim());
    if (form.type === "ntfy") return Boolean(ntfyForm.serverUrl.trim() && ntfyForm.topic.trim());
    if (form.type === "pushover") return Boolean(pushoverForm.appToken.trim() && pushoverForm.userKey.trim());
    return false;
  };

  const testDraftMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Service name is required.");
      if (addTestRemoteId == null) throw new Error("Select a deploy host to run the test.");
      const org = organizationPublicId?.trim();
      if (!org) throw new Error("Organization workspace is required.");
      const tempChannel = await createNotificationChannel(accessToken!, {
        name: `${form.name.trim()} (test)`,
        type: form.type.trim(),
        config: platformPayload(),
        remoteServerId: addTestRemoteId,
        organizationPublicId: org,
      });
      try {
        return await testNotificationChannel(accessToken!, tempChannel.id, org);
      } finally {
        try {
          await deleteNotificationChannel(accessToken!, tempChannel.id, org);
        } catch {}
      }
    },
    onSuccess: (res) => {
      if (res.success) toast({ title: "Test succeeded", description: res.message });
      else toast({ title: "Test failed", description: res.message, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });
  const createMutation = useMutation({
    mutationFn: () => {
      const org = organizationPublicId?.trim();
      if (!org) throw new Error("Organization workspace is required.");
      return createNotificationChannel(accessToken!, {
        name: form.name.trim(),
        type: form.type.trim(),
        config: platformPayload(),
        organizationPublicId: org,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      setForm({ name: "", type: "telegram" });
      setAddTestRemoteId(null);
      setShowAdd(false);
      toast({ title: "Channel added", description: "Notification channel saved." });
      if (isCreateRoute) router.push(listBase);
    },
    onError: (e: Error) => toast({ title: "Could not add channel", description: e.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      deleteNotificationChannel(accessToken!, id, organizationPublicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      toast({ title: "Channel removed" });
    },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const bulkDeleteChannelsMutation = useMutation({
    mutationFn: (ids: string[]) =>
      bulkDeleteNotificationChannels(accessToken!, ids, organizationPublicId),
    onSuccess: () => {
      channelsBulk.clear();
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      toast({ title: "Channels removed" });
    },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const testMutation = useMutation({
    mutationFn: async ({
      channelId,
      remoteServerId,
      previousRemoteId,
    }: {
      channelId: number;
      remoteServerId: number;
      previousRemoteId: number | null;
    }) => {
      if (!accessToken) throw new Error("Not signed in.");
      if (remoteServerId !== previousRemoteId) {
        await updateNotificationChannel(accessToken, channelId, { remoteServerId }, organizationPublicId);
      }
      return testNotificationChannel(accessToken, channelId, organizationPublicId);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      if (res.success) {
        toast({ title: "Test succeeded", description: res.message });
        setShowChannelAction(false);
      } else {
        toast({ title: "Test failed", description: res.message, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const updateChannelMutation = useMutation({
    mutationFn: async () => {
      if (!editChannel) throw new Error("No channel selected.");
      if (editDeployServerId === "") {
        throw new Error("Select a host for Run test from.");
      }
      return updateNotificationChannel(
        accessToken!,
        editChannel.id,
        {
          name: editName.trim(),
          remoteServerId: editDeployServerId as number,
        },
        organizationPublicId,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      setShowEditChannel(false);
      setEditChannel(null);
      toast({ title: "Channel updated" });
      if (isEditRoute) router.push(listBase);
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const openEditChannel = (ch: NotificationChannel) => {
    if (inOrgNotifications && !allowNotificationsEdit) {
      toast({
        title: "Not allowed",
        description: "Your role cannot edit notification channels in this organization.",
        variant: "destructive",
      });
      return;
    }
    setEditChannel(ch);
    setEditName(ch.name);
    setEditDeployServerId(ch.remoteServerId ?? "");
    setShowEditChannel(true);
  };

  const closeEditChannel = () => {
    if (updateChannelMutation.isPending) return;
    setShowEditChannel(false);
    setEditChannel(null);
    if (isEditRoute) router.push(listBase);
  };

  const toggleReveal = (id: string) => setRevealedTokens((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const addFormReady = Boolean(form.name.trim() && isPlatformValid());

  const addChannel = () => {
    if (inOrgNotifications && !allowNotificationsAdd) {
      toast({
        title: "Not allowed",
        description: "Your role cannot add notification channels in this organization.",
        variant: "destructive",
      });
      return;
    }
    if (!form.name.trim()) return toast({ title: "Missing name", description: "Please enter a service name before saving.", variant: "destructive" });
    if (!isPlatformValid()) return toast({ title: "Missing fields", description: "Please complete required fields for this provider.", variant: "destructive" });
    createMutation.mutate();
  };
  const runDraftTest = () => {
    if (inOrgNotifications && (!allowNotificationsAdd || !allowNotificationsTest)) {
      toast({
        title: "Not allowed",
        description:
          "Draft test needs permission to add channels and to run tests in this organization.",
        variant: "destructive",
      });
      return;
    }
    if (!form.name.trim()) return toast({ title: "Missing name", description: "Please enter a service name before testing.", variant: "destructive" });
    if (!isPlatformValid()) return toast({ title: "Missing fields", description: "Please complete required fields for this provider.", variant: "destructive" });
    if (addTestRemoteId == null) {
      return toast({
        title: "Choose a deploy host",
        description: "Select which remote server should run the test.",
        variant: "destructive",
      });
    }
    testDraftMutation.mutate();
  };
  const openChannelActions = (ch: NotificationChannel) => {
    if (inOrgNotifications && !allowNotificationsTest) {
      toast({
        title: "Not allowed",
        description: "Your role cannot run notification tests in this organization.",
        variant: "destructive",
      });
      return;
    }
    setActionChannel({
      id: ch.id,
      name: ch.name,
      remoteServerId: ch.remoteServerId,
    });
    setTestActionRemoteId(ch.remoteServerId ?? "");
    setShowChannelAction(true);
  };
  const runChannelTest = () => {
    if (!actionChannel) return;
    if (inOrgNotifications && !allowNotificationsTest) {
      toast({
        title: "Not allowed",
        description: "Your role cannot run notification tests in this organization.",
        variant: "destructive",
      });
      return;
    }
    if (testActionRemoteId === "") {
      toast({
        title: "Select a deploy host",
        description: "Choose which server runs the test over SSH.",
        variant: "destructive",
      });
      return;
    }
    if (deployServers.length === 0) return;
    const nextRemote = testActionRemoteId as number;
    const remoteChanging = actionChannel.remoteServerId !== nextRemote;
    if (inOrgNotifications && remoteChanging && !allowNotificationsEdit) {
      toast({
        title: "Not allowed",
        description: "Changing the deploy host requires edit access to notification channels.",
        variant: "destructive",
      });
      return;
    }
    testMutation.mutate({
      channelId: actionChannel.id,
      remoteServerId: testActionRemoteId as number,
      previousRemoteId: actionChannel.remoteServerId,
    });
  };
  const handleBulkDeleteChannels = async () => {
    if (inOrgNotifications && !allowNotificationsEdit) {
      toast({
        title: "Not allowed",
        description: "Your role cannot delete notification channels in this organization.",
        variant: "destructive",
      });
      return;
    }
    const ids = channelsBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected channels?",
      description: `Delete ${ids.length} channel(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    bulkDeleteChannelsMutation.mutate(ids);
  };

  const handleDeleteChannel = async (id: string, name: string) => {
    if (inOrgNotifications && !allowNotificationsEdit) {
      toast({
        title: "Not allowed",
        description: "Your role cannot delete notification channels in this organization.",
        variant: "destructive",
      });
      return;
    }
    const ok = await confirm({
      title: "Delete channel?",
      description: `“${name}” will be removed and can no longer receive notifications.`,
      confirmLabel: "Delete channel",
      variant: "destructive",
    });
    if (!ok) return;
    deleteMutation.mutate(id);
  };
  const setChannelsPageUrl = (next: number) => {
    const n = Math.max(1, next);
    setChannelsPage(n);
    const params = new URLSearchParams();
    const q = channelsQ.trim();
    if (q) params.set("q", q);
    params.set("page", String(n));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const loading = Boolean(accessToken) && channelsPagedQuery.isLoading && !channelsPaged;
  const queryErrorMessage =
    channelsPagedQuery.error instanceof Error ? channelsPagedQuery.error.message : "Could not load notifications.";
  const listError = (Boolean(initialError) && !channelsPaged) || (Boolean(accessToken) && channelsPagedQuery.isError);
  const listErrorMessage = !channelsPaged && initialError ? initialError : queryErrorMessage;
  const closeAddModal = () => {
    setShowAdd(false);
    setForm({ name: "", type: "telegram" });
    setAddTestRemoteId(null);
    setTelegramForm({ token: "", target: "" });
    if (isCreateRoute) router.push(listBase);
  };

  return (
    <>
      <div className="mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input className="input-field !pl-10 w-full bg-card/50" placeholder="Search channels..." value={channelsLocalQ} onChange={(e) => setChannelsLocalQ(e.target.value)} />
        </div>
        {channels.length > 0 && allowNotificationsEdit && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox checked={channelsBulk.allSelected ? true : channelsBulk.someSelected ? "indeterminate" : false} onCheckedChange={() => channelsBulk.toggleAllFiltered()} aria-label="Select all channels on this page" />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({channels.length})
              </span>
            </div>
            {channelsBulk.selectedInFiltered.length > 0 && (
              <button type="button" onClick={handleBulkDeleteChannels} disabled={bulkDeleteChannelsMutation.isPending || deleteMutation.isPending} className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm">
                {bulkDeleteChannelsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({channelsBulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        )}
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground mb-4"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
      {listError && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {listErrorMessage}
          <button type="button" className="ml-3 underline underline-offset-2 hover:text-destructive/90" onClick={() => void queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] })}>
            Retry
          </button>
        </div>
      )}
      {typeof document !== "undefined" &&
        createPortal(
          showAdd ? (
            <div
              className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-start justify-center px-4 py-6 md:px-6 md:py-8"
              onClick={closeAddModal}
            >
            <div
              className="w-full max-w-3xl glass-panel rounded-xl border border-primary/25 p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0 pr-2">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    Add Notification Channel
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Create a provider. Assign a deploy host when you are ready (Edit), or use Test below to try from a host
                    without saving one on the channel yet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                  aria-label="Close add channel dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-3 mb-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Channel name</label>
                <input className="input-field text-sm" placeholder="e.g. Production Alerts" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="rounded-lg border border-border bg-muted/60 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Provider</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {CHANNEL_TYPE_OPTIONS.map((option) => {
                    const PlatformIcon = option.icon;
                    const pickerWrap = isPushoverChannel(option.value)
                      ? CHANNEL_ICON_PICKER_WRAP_PUSH
                      : CHANNEL_ICON_PICKER_WRAP;
                    const inPicker = CHANNEL_ICON_PICKER_INNER;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setForm({ ...form, type: option.value })}
                        className={`flex h-full min-h-[4.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 text-center rounded-md border px-1 py-2 text-[0.7rem] leading-tight transition-colors sm:text-xs ${
                          form.type === option.value
                            ? "border-primary/50 bg-primary/10 text-foreground dark:border-primary/60 dark:bg-primary/15"
                            : "border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className={pickerWrap}>
                          {isTelegramChannel(option.value) ? (
                            <TelegramLogoIcon className={inPicker} />
                          ) : isDiscordChannel(option.value) ? (
                            <DiscordLogoIcon className={inPicker} />
                          ) : isSlackChannel(option.value) ? (
                            <SlackLogoIcon className={inPicker} />
                          ) : isLarkChannel(option.value) ? (
                            <LarkLogoIcon className={inPicker} />
                          ) : isMicrosoftTeamsChannel(option.value) ? (
                            <MicrosoftTeamsLogoIcon className={inPicker} />
                          ) : isEmailChannel(option.value) ? (
                            <EmailLogoIcon className={`${inPicker} text-blue-600 dark:text-blue-400`} />
                          ) : isResendChannel(option.value) ? (
                            <ResendLogoIcon className={`${inPicker} text-black dark:text-white`} />
                          ) : isGotifyChannel(option.value) ? (
                            <GotifyLogoIcon className={inPicker} />
                          ) : isNtfyChannel(option.value) ? (
                            <NtfyLogoIcon className={`${inPicker} text-black dark:text-white`} />
                          ) : isPushoverChannel(option.value) ? (
                            <PushoverLogoIcon className={inPicker} />
                          ) : (
                            <PlatformIcon className={`${inPicker} ${option.iconClass}`} />
                          )}
                        </span>
                        <span className="line-clamp-2 w-full px-0.5">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.type === "telegram" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 flex items-center justify-between">
                      Telegram Token
                      <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-sm">
                        Get from BotFather <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </label>
                    <input className="input-field font-mono text-sm" placeholder="123456789:ABCdef..." value={telegramForm.token} onChange={(e) => setTelegramForm({ ...telegramForm, token: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 flex items-center justify-between">
                      Target <span className="text-sm text-muted-foreground/60">Use @username or numeric ID</span>
                    </label>
                    <input className="input-field font-mono text-sm" placeholder="-1001234567890" value={telegramForm.target} onChange={(e) => setTelegramForm({ ...telegramForm, target: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "email" && (
                <>
                  <p className="text-sm font-medium">Fill the next fields.</p>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">SMTP Server</label>
                    <input className="input-field font-mono text-sm" placeholder="smtp.gmail.com" value={emailForm.smtpServer} onChange={(e) => setEmailForm({ ...emailForm, smtpServer: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">SMTP Port</label>
                    <input className="input-field font-mono text-sm" placeholder="587" type="number" value={emailForm.smtpPort} onChange={(e) => setEmailForm({ ...emailForm, smtpPort: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Username</label>
                    <input className="input-field" placeholder="username" value={emailForm.username} onChange={(e) => setEmailForm({ ...emailForm, username: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Password</label>
                    <input className="input-field" type="password" placeholder="****************" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">From Address</label>
                    <input className="input-field" placeholder="from@example.com" value={emailForm.fromAddress} onChange={(e) => setEmailForm({ ...emailForm, fromAddress: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground block">To Addresses</label>
                    {emailForm.toAddresses.map((address, index) => (
                      <div key={index} className="flex gap-2">
                        <input className="input-field" placeholder="email@example.com" value={address} onChange={(e) => updateEmailRecipient(index, e.target.value)} />
                        <button type="button" onClick={() => removeEmailRecipient(index)} className="btn-secondary text-sm px-3" disabled={emailForm.toAddresses.length === 1}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addEmailRecipient} className="btn-secondary text-sm w-full">
                      Add
                    </button>
                  </div>
                </>
              )}

              {form.type === "discord" && (
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Webhook URL</label>
                  <input className="input-field font-mono text-sm" placeholder="https://discord.com/api/webhooks/..." value={discordForm.webhookUrl} onChange={(e) => setDiscordForm({ webhookUrl: e.target.value })} />
                </div>
              )}

              {form.type === "slack" && (
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Incoming webhook URL</label>
                  <input
                    className="input-field font-mono text-sm"
                    placeholder="https://hooks.slack.com/services/..."
                    value={slackForm.webhookUrl}
                    onChange={(e) => setSlackForm({ webhookUrl: e.target.value })}
                  />
                </div>
              )}

              {form.type === "lark" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Webhook URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..." value={larkForm.webhookUrl} onChange={(e) => setLarkForm({ ...larkForm, webhookUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Secret (optional)</label>
                    <input className="input-field" placeholder="Lark signing secret" value={larkForm.secret} onChange={(e) => setLarkForm({ ...larkForm, secret: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "microsoft-teams" && (
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Incoming Webhook URL</label>
                  <input className="input-field font-mono text-sm" placeholder="https://outlook.office.com/webhook/..." value={teamsForm.webhookUrl} onChange={(e) => setTeamsForm({ webhookUrl: e.target.value })} />
                </div>
              )}

              {form.type === "resend" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">API Key</label>
                    <input className="input-field" placeholder="re_..." value={resendForm.apiKey} onChange={(e) => setResendForm({ ...resendForm, apiKey: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">From Address</label>
                    <input className="input-field" placeholder="alerts@yourdomain.com" value={resendForm.fromAddress} onChange={(e) => setResendForm({ ...resendForm, fromAddress: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">To Address</label>
                    <input className="input-field" placeholder="team@yourdomain.com" value={resendForm.toAddress} onChange={(e) => setResendForm({ ...resendForm, toAddress: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "gotify" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Server URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://gotify.example.com" value={gotifyForm.serverUrl} onChange={(e) => setGotifyForm({ ...gotifyForm, serverUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">App Token</label>
                    <input className="input-field" placeholder="Gotify app token" value={gotifyForm.appToken} onChange={(e) => setGotifyForm({ ...gotifyForm, appToken: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Priority</label>
                    <input className="input-field" type="number" min={1} max={10} value={gotifyForm.priority} onChange={(e) => setGotifyForm({ ...gotifyForm, priority: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "ntfy" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Server URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://ntfy.sh" value={ntfyForm.serverUrl} onChange={(e) => setNtfyForm({ ...ntfyForm, serverUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Topic</label>
                    <input className="input-field" placeholder="weehawk-alerts" value={ntfyForm.topic} onChange={(e) => setNtfyForm({ ...ntfyForm, topic: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Access Token (optional)</label>
                    <input className="input-field" placeholder="Bearer token" value={ntfyForm.token} onChange={(e) => setNtfyForm({ ...ntfyForm, token: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "pushover" && (
                <>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">User Key</label>
                    <input className="input-field" placeholder="Pushover user key" value={pushoverForm.userKey} onChange={(e) => setPushoverForm({ ...pushoverForm, userKey: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">App Token</label>
                    <input className="input-field" placeholder="Pushover API token" value={pushoverForm.appToken} onChange={(e) => setPushoverForm({ ...pushoverForm, appToken: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Device (optional)</label>
                    <input className="input-field" placeholder="iphone-15" value={pushoverForm.device} onChange={(e) => setPushoverForm({ ...pushoverForm, device: e.target.value })} />
                  </div>
                </>
              )}

              </div>

              <div className="relative z-10 mt-4 mb-4 rounded-xl border border-primary/20 bg-primary/[0.06] p-4 md:p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <div className="flex flex-col gap-1 mb-3">
                  <span className="text-sm font-semibold text-foreground">Test connection</span>
                  <span className="text-xs text-muted-foreground">
                    Optional: send a fixed test from a deploy host over SSH. Saving the channel does not require a test or
                    a host here — set a deploy host later via Edit when you want deliveries.
                  </span>
                </div>
                <div>
                  <label htmlFor="notify-add-test-from" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Run test from <span className="font-normal text-muted-foreground/80">(optional)</span>
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <select
                      id="notify-add-test-from"
                      className="input-field-sm w-full sm:flex-1 min-w-0 h-9 min-h-9 py-0 text-sm leading-normal"
                      value={addTestRemoteId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddTestRemoteId(v === "" ? null : Number(v));
                      }}
                    >
                      <option value="">Select a deploy host…</option>
                      {deployServers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.host})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={runDraftTest}
                      disabled={
                        testDraftMutation.isPending ||
                        createMutation.isPending ||
                        !addFormReady ||
                        addTestRemoteId == null ||
                        deployServers.length === 0 ||
                        !allowNotificationsAdd ||
                        !allowNotificationsTest
                      }
                      title="Creates a temporary channel on the selected host, runs one test, then deletes it"
                      className="btn-secondary text-sm border border-primary/40 text-primary inline-flex items-center justify-center gap-1.5 shrink-0 h-9 min-h-9 px-3 disabled:opacity-50"
                    >
                      {testDraftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                      Test
                    </button>
                  </div>
                </div>
                {deployServers.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2.5">
                    Add a deploy server under Remote servers to run a test from that host.
                  </p>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                <button type="button" onClick={closeAddModal} className="btn-secondary w-full text-sm sm:w-auto">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addChannel}
                  disabled={
                    !addFormReady ||
                    createMutation.isPending ||
                    testDraftMutation.isPending ||
                    !allowNotificationsAdd
                  }
                  className="btn-primary w-full text-sm sm:w-auto disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Add Channel
                </button>
              </div>
            </div>
          </div>
          ) : null,
        document.body,
        )}

      {typeof document !== "undefined" &&
        createPortal(
          showChannelAction && actionChannel ? (
            <div
              className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex items-center justify-center p-4"
              onClick={() => {
                if (testMutation.isPending) return;
                setShowChannelAction(false);
              }}
            >
            <div
              className="w-full max-w-xl glass-panel rounded-2xl border border-primary/25 p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Test channel</h3>
                  <p className="text-sm text-muted-foreground mt-1">{actionChannel.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelAction(false);
                  }}
                  disabled={testMutation.isPending}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 mb-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Test message is sent from the deploy host you pick through SSH—not from the app server.
                </p>
              </div>

              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1 block">Run test from</label>
                <select
                  className="input-field text-sm"
                  value={testActionRemoteId === "" ? "" : String(testActionRemoteId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTestActionRemoteId(v === "" ? "" : Number(v));
                  }}
                  disabled={testMutation.isPending || deployServers.length === 0}
                >
                  {deployServers.length === 0 && <option value="">No deploy servers</option>}
                  {deployServers.length > 0 && <option value="">Select a host…</option>}
                  {deployServers.map((srv) => (
                    <option key={srv.id} value={srv.id}>
                      {srv.name} ({srv.host})
                    </option>
                  ))}
                </select>
                {deployServers.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Add a deploy server under Remote servers first.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowChannelAction(false)}
                  disabled={testMutation.isPending}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runChannelTest}
                  disabled={
                    testMutation.isPending ||
                    testActionRemoteId === "" ||
                    deployServers.length === 0
                  }
                  className="btn-secondary text-sm border border-primary/40 text-primary inline-flex items-center justify-center gap-1.5 h-9 min-h-9 px-3 disabled:opacity-50"
                >
                  {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                  Test
                </button>
              </div>
            </div>
          </div>
          ) : null,
        document.body,
        )}
      {typeof document !== "undefined" &&
        createPortal(
          showEditChannel && editChannel ? (
            <div
              className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex items-center justify-center p-4"
              onClick={closeEditChannel}
            >
              <div
                className="w-full max-w-lg glass-panel rounded-2xl border border-primary/25 p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Edit channel</h3>
                    <p className="text-sm text-muted-foreground mt-1">{channelTypeLabel(editChannel.type)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeEditChannel}
                    disabled={updateChannelMutation.isPending}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Name</label>
                    <input
                      className="input-field text-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={updateChannelMutation.isPending}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Run test from</label>
                    <select
                      className="input-field text-sm"
                      value={editDeployServerId === "" ? "" : String(editDeployServerId)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditDeployServerId(v === "" ? "" : Number(v));
                      }}
                      disabled={deployServers.length === 0 || updateChannelMutation.isPending}
                    >
                      {deployServers.length === 0 && <option value="">No deploy servers</option>}
                      {deployServers.length > 0 && <option value="">Select a host…</option>}
                      {deployServers.map((srv) => (
                        <option key={srv.id} value={srv.id}>
                          {srv.name} ({srv.host})
                        </option>
                      ))}
                    </select>
                    <p className="text-[0.7rem] text-muted-foreground mt-1.5">
                      Provider credentials are unchanged. To change tokens or webhooks, delete and add the channel again.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={closeEditChannel} disabled={updateChannelMutation.isPending} className="btn-secondary text-sm">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      updateChannelMutation.isPending ||
                      !editName.trim() ||
                      editDeployServerId === "" ||
                      deployServers.length === 0
                    }
                    onClick={() => {
                      if (!editName.trim()) {
                        toast({ title: "Name required", variant: "destructive" });
                        return;
                      }
                      if (editDeployServerId === "") {
                        toast({ title: "Run test from required", description: "Select a host.", variant: "destructive" });
                        return;
                      }
                      updateChannelMutation.mutate();
                    }}
                    className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {updateChannelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null,
        document.body,
        )}
      {!loading && !listError && channels.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Bell className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No channels configured</h3>
          <p className="text-muted-foreground mb-8 max-w-md">Add your first provider to start receiving notifications.</p>
          {allowNotificationsAdd ? (
            <Link href={`${listBase}/create`} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add Channel
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {channels.map((ch, i) => (
              <motion.div
                key={ch.id}
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      {(() => {
                        const meta = channelTypeMeta(ch.type);
                        const cardWrap = meta && isPushoverChannel(meta.value)
                          ? CHANNEL_ICON_CARD_WRAP_PUSH
                          : CHANNEL_ICON_CARD_WRAP;
                        const inCard = CHANNEL_ICON_CARD_INNER;
                        if (!meta) {
                          return (
                            <span className={cardWrap}>
                              <Bell className={`${inCard} text-primary`} />
                            </span>
                          );
                        }
                        const PlatformIcon = meta.icon;
                        if (isTelegramChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <TelegramLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isDiscordChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <DiscordLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isSlackChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <SlackLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isLarkChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <LarkLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isMicrosoftTeamsChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <MicrosoftTeamsLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isEmailChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <EmailLogoIcon className={`${inCard} text-blue-600 dark:text-blue-400`} />
                            </span>
                          );
                        }
                        if (isResendChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <ResendLogoIcon className={`${inCard} text-black dark:text-white`} />
                            </span>
                          );
                        }
                        if (isGotifyChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <GotifyLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        if (isNtfyChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <NtfyLogoIcon className={`${inCard} text-black dark:text-white`} />
                            </span>
                          );
                        }
                        if (isPushoverChannel(meta.value)) {
                          return (
                            <span className={cardWrap}>
                              <PushoverLogoIcon className={inCard} />
                            </span>
                          );
                        }
                        return (
                          <span className={cardWrap}>
                            <PlatformIcon className={`${inCard} ${meta.iconClass}`} />
                          </span>
                        );
                      })()}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg leading-tight truncate" title={ch.name}>
                        {ch.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {channelTypeLabel(ch.type)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <button
                      type="button"
                    onClick={() => handleDeleteChannel(notificationChannelRouteId(ch), ch.name)}
                      disabled={
                        deleteMutation.isPending ||
                        bulkDeleteChannelsMutation.isPending ||
                        !allowNotificationsEdit
                      }
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
                      title={
                        allowNotificationsEdit
                          ? "Delete"
                          : "Your role cannot delete notification channels in this organization"
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {allowNotificationsEdit ? (
                      <div
                        className={`transition-opacity ${
                          channelsBulk.selected.has(notificationChannelRouteId(ch))
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <DockerBulkCheckbox
                          checked={channelsBulk.selected.has(notificationChannelRouteId(ch))}
                          onCheckedChange={() => channelsBulk.toggle(notificationChannelRouteId(ch))}
                          aria-label={`Select channel ${ch.name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground mb-4">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="truncate">
                      Credential: {revealedTokens.has(String(ch.id)) ? ch.credentialPreview : "••••••••••••••••"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReveal(String(ch.id))}
                      className="hover:text-foreground transition-colors flex-shrink-0"
                    >
                      {revealedTokens.has(String(ch.id)) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-sm font-mono truncate">Target: {ch.targetPreview}</p>
                </div>

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1 min-w-0">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={`Created (UTC) ${formatDateUTC(ch.createdAt)}`}>
                      {formatDateUTC(ch.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-end shrink-0">
                    {allowNotificationsEdit ? (
                      <Link
                        href={`${listBase}/${encodeURIComponent(String(ch.publicId ?? ch.id))}/edit`}
                        className={`text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 ${
                          updateChannelMutation.isPending || testMutation.isPending
                            ? "pointer-events-none opacity-50"
                            : ""
                        }`}
                        title="Edit name and Run test from host"
                      >
                        {updateChannelMutation.isPending && editChannel?.id === ch.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Pencil className="w-3 h-3" />
                        )}
                        Edit
                      </Link>
                    ) : (
                      <span
                        className="cursor-not-allowed font-medium text-muted-foreground/70 flex items-center gap-1"
                        title="Your role cannot edit notification channels in this organization"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => openChannelActions(ch)}
                      disabled={
                        testMutation.isPending ||
                        updateChannelMutation.isPending ||
                        !allowNotificationsTest
                      }
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 disabled:opacity-50"
                      title={
                        allowNotificationsTest
                          ? "Run test (pick deploy host in dialog)"
                          : "Your role cannot run notification tests in this organization"
                      }
                    >
                      {testMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FlaskConical className="w-3 h-3" />
                      )}
                      Test
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          {channelsPaged ? <ListPagination page={channelsPaged.page} totalPages={Math.max(1, Math.ceil(channelsPaged.total / channelsPaged.pageSize))} onPageChange={setChannelsPageUrl} from={channelsPaged.total > 0 ? (channelsPaged.page - 1) * channelsPaged.pageSize + 1 : 0} to={Math.min(channelsPaged.page * channelsPaged.pageSize, channelsPaged.total)} total={channelsPaged.total} /> : null}
        </>
      )}
    </>
  );
}
