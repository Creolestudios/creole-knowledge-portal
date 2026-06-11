import logging
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, ASCENDING, TEXT
from src.config import settings

logger = logging.getLogger(__name__)

class MongoDBConnection:
    def __init__(self):
        self.client = None
        self.db = None

    def connect(self):
        if not self.client:
            logger.info("Initializing MongoDB Client...")
            self.client = AsyncIOMotorClient(settings.MONGODB_URI)
            # Default database name 'creole_knowledge'
            self.db = self.client.get_database("creole_knowledge")
            logger.info("MongoDB Connection Established successfully.")

    def close(self):
        if self.client:
            self.client.close()
            self.client = None
            self.db = None
            logger.info("MongoDB connection closed.")

    async def setup_indexes(self):
        if self.db is None:
            self.connect()
        
        logger.info("Ensuring database indexes exist...")
        try:
            # 1. Unique Index on Articles URL
            await self.db.articles.create_index([("url", ASCENDING)], unique=True)
            
            # 2. Text Search index for keyword matching
            await self.db.articles.create_index([
                ("title", TEXT),
                ("body_text", TEXT),
                ("tags", TEXT)
            ], weights={"title": 10, "tags": 5, "body_text": 1})
            
            # 3. Unique Index on User Profiles
            await self.db.user_profiles.create_index([("user_id", ASCENDING)], unique=True)
            
            # 4. Daily Digests Index by User and Date
            await self.db.daily_digests.create_index([("user_id", ASCENDING), ("generated_at", ASCENDING)])
            
            # 5. Scraped Sources Index
            await self.db.scraped_sources.create_index([("url", ASCENDING), ("scraped_at", ASCENDING)])
            
            logger.info("All MongoDB indexes established successfully.")
        except Exception as e:
            logger.error(f"Error establishing MongoDB indexes: {e}")

# Global singleton connection object
mongo_manager = MongoDBConnection()

def get_db():
    if mongo_manager.db is None:
        mongo_manager.connect()
    return mongo_manager.db
