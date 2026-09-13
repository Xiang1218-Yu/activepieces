import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddChatHistoryIndexAndArchive1842000000000 implements Migration {
    name = 'AddChatHistoryIndexAndArchive1842000000000'
    breaking = false
    release = '0.91.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "agent_conversation" ADD COLUMN IF NOT EXISTS "archivedAt" timestamp with time zone
        `)

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "agent_conversation_history_index" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "conversationId" character varying(21) NOT NULL,
                "platformId" character varying(21) NOT NULL,
                "userId" character varying(21) NOT NULL,
                "projectId" character varying,
                "projectName" character varying,
                "title" character varying,
                "status" character varying NOT NULL,
                "archived" boolean NOT NULL DEFAULT false,
                "searchText" text,
                "resourceTypes" character varying[] NOT NULL DEFAULT '{}',
                "files" jsonb NOT NULL DEFAULT '[]',
                "connections" jsonb NOT NULL DEFAULT '[]',
                "messageCount" integer NOT NULL DEFAULT 0,
                "accessible" boolean NOT NULL DEFAULT true,
                "inaccessibleReason" character varying,
                "conversationCreatedAt" timestamp with time zone NOT NULL,
                "conversationUpdatedAt" timestamp with time zone NOT NULL,
                CONSTRAINT "pk_chat_history_index" PRIMARY KEY ("id"),
                CONSTRAINT "uq_chat_history_index_conversation" UNIQUE ("conversationId"),
                CONSTRAINT "fk_chat_history_index_conversation" FOREIGN KEY ("conversationId")
                    REFERENCES "agent_conversation" ("id") ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_chat_history_index_platform_user_updated"
            ON "agent_conversation_history_index" ("platformId", "userId", "conversationUpdatedAt" DESC, "id" DESC)
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_chat_history_index_project"
            ON "agent_conversation_history_index" ("projectId") WHERE "projectId" IS NOT NULL
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE IF EXISTS "agent_conversation_history_index"
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_conversation" DROP COLUMN IF EXISTS "archivedAt"
        `)
    }

}
