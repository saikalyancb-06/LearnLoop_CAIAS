export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          education_level: string | null;
          preferences: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          education_level?: string | null;
          preferences?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          education_level?: string | null;
          preferences?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          parent_folder_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          parent_folder_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          parent_folder_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          folder_id: string | null;
          title: string;
          original_filename: string;
          storage_path: string;
          mime_type: string;
          file_size_bytes: number | null;
          extracted_text: string | null;
          processing_status: string;
          completion_percent: number;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
          last_opened_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          folder_id?: string | null;
          title: string;
          original_filename: string;
          storage_path: string;
          mime_type: string;
          file_size_bytes?: number | null;
          extracted_text?: string | null;
          processing_status?: string;
          completion_percent?: number;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
          last_opened_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          folder_id?: string | null;
          title?: string;
          original_filename?: string;
          storage_path?: string;
          mime_type?: string;
          file_size_bytes?: number | null;
          extracted_text?: string | null;
          processing_status?: string;
          completion_percent?: number;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
          last_opened_at?: string | null;
        };
        Relationships: [];
      };
      document_sections: {
        Row: {
          id: string;
          document_id: string;
          title: string | null;
          content: string;
          sort_order: number;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          title?: string | null;
          content: string;
          sort_order?: number;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          title?: string | null;
          content?: string;
          sort_order?: number;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      flashcards: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          question: string;
          answer: string;
          difficulty: string | null;
          status: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          user_id: string;
          question: string;
          answer: string;
          difficulty?: string | null;
          status?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          user_id?: string;
          question?: string;
          answer?: string;
          difficulty?: string | null;
          status?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      feynman_sessions: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          topic: string;
          status: string;
          completion_percent: number;
          session_summary: string | null;
          target_question_count: number;
          current_question_count: number;
          extra_follow_up_count: number;
          started_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          user_id: string;
          topic: string;
          status?: string;
          completion_percent?: number;
          session_summary?: string | null;
          target_question_count?: number;
          current_question_count?: number;
          extra_follow_up_count?: number;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          user_id?: string;
          topic?: string;
          status?: string;
          completion_percent?: number;
          session_summary?: string | null;
          target_question_count?: number;
          current_question_count?: number;
          extra_follow_up_count?: number;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      feynman_messages: {
        Row: {
          id: string;
          session_id: string;
          role: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          role?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      feynman_results: {
        Row: {
          id: string;
          session_id: string;
          overall_score: number;
          concept_accuracy: number;
          clarity: number;
          completeness: number;
          teaching_ability: number;
          strengths: string[];
          misconceptions: string[];
          improvement_points: string[];
          knowledge_rating: string | null;
          ai_feedback: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          overall_score: number;
          concept_accuracy: number;
          clarity: number;
          completeness: number;
          teaching_ability: number;
          strengths?: string[];
          misconceptions?: string[];
          improvement_points?: string[];
          knowledge_rating?: string | null;
          ai_feedback?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          overall_score?: number;
          concept_accuracy?: number;
          clarity?: number;
          completeness?: number;
          teaching_ability?: number;
          strengths?: string[];
          misconceptions?: string[];
          improvement_points?: string[];
          knowledge_rating?: string | null;
          ai_feedback?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      progress_stats: {
        Row: {
          id: string;
          user_id: string;
          document_id: string | null;
          stat_date: string;
          study_minutes: number;
          mastery_score: number;
          flashcards_known: number;
          flashcards_difficult: number;
          feynman_score: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id?: string | null;
          stat_date: string;
          study_minutes?: number;
          mastery_score?: number;
          flashcards_known?: number;
          flashcards_difficult?: number;
          feynman_score?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          document_id?: string | null;
          stat_date?: string;
          study_minutes?: number;
          mastery_score?: number;
          flashcards_known?: number;
          flashcards_difficult?: number;
          feynman_score?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recent_activity: {
        Row: {
          id: string;
          user_id: string;
          document_id: string | null;
          session_id: string | null;
          activity_type: string;
          title: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id?: string | null;
          session_id?: string | null;
          activity_type: string;
          title: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          document_id?: string | null;
          session_id?: string | null;
          activity_type?: string;
          title?: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type TableName = keyof Database["public"]["Tables"];

export type TableRow<T extends TableName> = Database["public"]["Tables"][T]["Row"];
export type TableInsert<T extends TableName> = Database["public"]["Tables"][T]["Insert"];
export type TableUpdate<T extends TableName> = Database["public"]["Tables"][T]["Update"];
