-- Create storage bucket for temporary imports
INSERT INTO storage.buckets (id, name, public) VALUES ('temp-imports', 'temp-imports', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access for temp imports"
ON storage.objects
FOR SELECT
USING (bucket_id = 'temp-imports');

-- Allow authenticated uploads
CREATE POLICY "Authenticated uploads for temp imports"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'temp-imports' AND auth.role() = 'authenticated');