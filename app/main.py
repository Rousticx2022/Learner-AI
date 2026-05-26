import os
import shutil
import time
from typing import List
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
import google.generativeai as genai
from dotenv import load_dotenv

from . import models, database

load_dotenv()

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL_NAME = "gemini-3.1-flash-lite" 
if not GEMINI_API_KEY or GEMINI_API_KEY == "your_api_key_here":
    print("WARNING: GEMINI_API_KEY not set in environment or .env file.")
else:
    genai.configure(api_key=GEMINI_API_KEY)

# Create database tables
models.Base.metadata.create_all(bind=database.engine)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = FastAPI()

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
app.mount("/uploads", StaticFiles(directory=os.path.join(BASE_DIR, "uploads")), name="uploads")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, db: Session = Depends(database.get_db)):
    documents = db.query(models.Document).order_by(models.Document.created_at.desc()).all()
    return templates.TemplateResponse(
        request=request, name="index.html", context={"documents": documents}
    )

@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...), db: Session = Depends(database.get_db)):
    uploaded_docs = []
    for file in files:
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Upload to Gemini File API
        try:
            gemini_file = genai.upload_file(path=file_path, display_name=file.filename)
            
            # Wait for file processing if it's a video/large file
            # In a production app, we'd do this asynchronously
            while gemini_file.state.name == "PROCESSING":
                time.sleep(2)
                gemini_file = genai.get_file(gemini_file.name)
            
            if gemini_file.state.name == "FAILED":
                raise HTTPException(status_code=500, detail=f"Gemini processing failed for {file.filename}")

            doc = models.Document(
                filename=file.filename,
                file_type=file.content_type,
                gemini_file_uri=gemini_file.uri
            )
            db.add(doc)
            db.commit()
            db.refresh(doc)
            uploaded_docs.append({"id": doc.id, "filename": doc.filename})
        except Exception as e:
            print(f"Error uploading {file.filename} to Gemini: {e}")
            raise HTTPException(status_code=500, detail=str(e))
            
    return {"message": "Files uploaded successfully", "documents": uploaded_docs}

@app.get("/api/documents")
async def get_documents(db: Session = Depends(database.get_db)):
    docs = db.query(models.Document).all()
    return docs

@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: int, db: Session = Depends(database.get_db)):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Remove from Gemini File API
    try:
        file_name = doc.gemini_file_uri.split('/')[-1]
        genai.delete_file(file_name)
    except Exception as e:
        print(f"Error deleting file from Gemini: {e}")
        # We continue even if Gemini deletion fails (e.g., file already expired)

    # Remove from local storage
    file_path = os.path.join(UPLOAD_DIR, doc.filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    
    # Remove from DB
    db.delete(doc)
    db.commit()
    
    return {"message": "Document deleted successfully"}

@app.post("/api/chat")
async def chat(request: Request, db: Session = Depends(database.get_db)):
    data = await request.json()
    prompt = data.get("prompt")
    selected_doc_ids = data.get("document_ids", [])
    
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    
    # Get document URIs from DB
    docs = db.query(models.Document).filter(models.Document.id.in_(selected_doc_ids)).all()
    
    # Construct Gemini call with system instructions for timestamps
    system_instruction = "You are a helpful learning assistant. When referencing information from video materials, ALWAYS provide the exact timestamp in [MM:SS] format."
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL_NAME,
        system_instruction=system_instruction
    )
    
    contents = []
    for doc in docs:
        try:
            file_name = doc.gemini_file_uri.split('/')[-1]
            gemini_file = genai.get_file(file_name)
            contents.append(gemini_file)
        except Exception as e:
            print(f"Error retrieving file {doc.filename}: {e}")

    contents.append(prompt)
    
    try:
        response = model.generate_content(contents)
        # Store chat message
        user_msg = models.ChatMessage(role="user", content=prompt)
        ai_msg = models.ChatMessage(role="model", content=response.text)
        db.add(user_msg)
        db.add(ai_msg)
        db.commit()
        
        return {"answer": response.text}
    except Exception as e:
        print(f"Gemini generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/quiz")
async def generate_quiz(request: Request, db: Session = Depends(database.get_db)):
    data = await request.json()
    selected_doc_ids = data.get("document_ids", [])
    
    if not selected_doc_ids:
        raise HTTPException(status_code=400, detail="Please select at least one material for the quiz.")

    docs = db.query(models.Document).filter(models.Document.id.in_(selected_doc_ids)).all()
    
    model = genai.GenerativeModel(model_name=GEMINI_MODEL_NAME)
    
    contents = []
    for doc in docs:
        try:
            file_name = doc.gemini_file_uri.split('/')[-1]
            gemini_file = genai.get_file(file_name)
            contents.append(gemini_file)
        except Exception as e:
            print(f"Error retrieving file {doc.filename}: {e}")

    quiz_prompt = "Generate a 5-question multiple-choice quiz based on the provided materials. Return the result in a JSON array of objects, where each object has: 'question', 'options' (array of 4 strings), 'correct_index' (0-3), and 'explanation'."
    contents.append(quiz_prompt)

    try:
        response = model.generate_content(
            contents,
            generation_config={"response_mime_type": "application/json"}
        )
        import json
        quiz_data = json.loads(response.text)
        return {"quiz": quiz_data}
    except Exception as e:
        print(f"Quiz generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/suggestions")
async def get_suggestions(request: Request, db: Session = Depends(database.get_db)):
    data = await request.json()
    selected_doc_ids = data.get("document_ids", [])
    
    if not selected_doc_ids:
        return {"suggestions": []}

    docs = db.query(models.Document).filter(models.Document.id.in_(selected_doc_ids)).all()
    model = genai.GenerativeModel(model_name=GEMINI_MODEL_NAME)
    
    contents = []
    for doc in docs:
        try:
            file_name = doc.gemini_file_uri.split('/')[-1]
            gemini_file = genai.get_file(file_name)
            contents.append(gemini_file)
        except Exception as e:
            print(f"Error retrieving file {doc.filename}: {e}")

    suggestion_prompt = "Based on these materials, what are the 4 most important and relevant questions a student should ask to master this topic? Return them as a simple JSON array of strings."
    contents.append(suggestion_prompt)

    try:
        response = model.generate_content(
            contents,
            generation_config={"response_mime_type": "application/json"}
        )
        import json
        suggestions = json.loads(response.text)
        return {"suggestions": suggestions}
    except Exception as e:
        print(f"Suggestion error: {e}")
        return {"suggestions": ["What are the key concepts?", "How do these ideas relate?", "Can you summarize the main findings?", "What is the practical application?"]}

def get_local_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

if __name__ == "__main__":
    import uvicorn
    local_ip = get_local_ip()
    port = 8000
    
    print("\n" + "="*50)
    print("🚀 Learner AI is starting up!")
    print(f"🏠 Local Access:   http://localhost:{port}")
    print(f"🌐 Network Access: http://{local_ip}:{port}")
    print("="*50 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=port)
